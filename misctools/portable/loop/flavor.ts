// Writes the crates of bun that hold code for one OS as the portable image compiles them: once for each
// OS, from the same source.
//
// bun's code picks its OS with `cfg`: a crate compiled for Windows is the code for Windows. The portable
// image is compiled once, for a Linux target, and holds the code for every OS it runs on. For the crates
// at the bottom (bun_core, bun_sys, ..) one crate holds both and picks when it runs. For what is above
// them the image holds the crate twice, a "flavour" for each OS: the source of bun, unchanged, with what
// a compiler for that OS would decide written into it. The program at the top picks the flavour once.
//
//   bun flavor.ts --os windows|posix --out <dir> --roots a,b --seeds c,d [--defined-in x.a,y.o]
//                 [--flavoured-c z.o,..] [--arch x86_64]
//
//   --roots        crates of the workspace (or directories of crates outside of it, with a `/`) that the
//                  image is built from
//   --seeds        the crates that have a flavour. Every crate that depends on one has a flavour too.
//   --defined-in   archives and objects of the image that are not Rust: a function they define is the
//                  image's, a function nothing defines is the host's
//   --flavoured-c  objects of C code that is compiled once for each OS too (uSockets): what they define
//                  has the name of the flavour
//
// What is written, under <out>/<os>/<crate>:
//   - the files of the crate. A `.rs` file is rewritten, see `rewrite`; every other file is a copy.
//   - Cargo.toml: the package `<crate>__<os>` with the library name of the crate, so that the source of
//     a crate that uses it names it as it does in bun. A dependency that has a flavour is the flavour.
//   - build.rs: tells the compiler and bun's macros which flavour this is.
//   <out>/<os>/flavor.json: what was done, for the build and for the report.
//
// The rewriting is by rule, and the compiler checks it: a function pointer that is given the wrong calling
// convention does not have the type that libuv's or uSockets' binding asks for.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Edits, tokens, type Token } from "./rust_tokens.ts";

type Os = "windows" | "posix";

export type Rules = {
  os: Os;
  arch: string;
  /** Symbols that code of this flavour defines: the exports of its crates and of its C code. */
  ofFlavour: Set<string>;
  /** Symbols that the image defines once, for every flavour. */
  ofImage: Set<string>;
};

export type Done = {
  cfg: number;
  native: number;
  longs: number;
  exports: string[];
  renamed: string[];
  imports: { symbol: string; library: string }[];
  /** Functions of bun that are declared and that nothing the image is built from defines. */
  missing: string[];
  callbacks: string[];
  callbackTypes: number;
};

const newDone = (): Done => ({
  cfg: 0,
  native: 0,
  longs: 0,
  exports: [],
  renamed: [],
  imports: [],
  missing: [],
  callbacks: [],
  callbackTypes: 0,
});

/** What the compiler for Windows says of a `key = "value"` of `cfg`, undefined for what the image's says too. */
function windowsHas(key: string, value: string): boolean | undefined {
  switch (key) {
    case "target_os":
      return value === "windows";
    case "target_family":
      return value === "windows";
    case "target_env":
      return value === "msvc";
    case "target_vendor":
      return value === "pc";
    default:
      return undefined;
  }
}

const stringOf = (literal: string) => literal.slice(1, -1);

/** The predicate of a `cfg`, between two tokens, as the compiler for the OS of the flavour decides it. */
function decide(all: Token[], from: number, to: number, edits: Edits, done: Done) {
  for (let i = from; i < to; i++) {
    const token = all[i];
    if (token.kind !== "ident") continue;
    const next = all[i + 1];
    const previous = all[i - 1];
    if (
      (token.text === "windows" || token.text === "unix") &&
      next?.text !== "=" &&
      next?.text !== "(" &&
      previous?.text !== "="
    ) {
      edits.replace(token.start, token.end, token.text === "windows" ? "all()" : "any()");
      done.cfg++;
      continue;
    }
    if (next?.text === "=" && all[i + 2]?.kind === "literal" && i + 2 < to) {
      const has = windowsHas(token.text, stringOf(all[i + 2].text));
      if (has === undefined) continue;
      edits.replace(token.start, all[i + 2].end, has ? "all()" : "any()");
      done.cfg++;
      i += 2;
    }
  }
}

/** The index of the first `,` between two tokens that is in no bracket, or `to`. */
function firstComma(all: Token[], from: number, to: number) {
  for (let i = from; i < to; i++) {
    if (all[i].kind === "open") i = all[i].partner;
    else if (all[i].text === ",") return i;
  }
  return to;
}

function everyCfg(all: Token[], edits: Edits, done: Done) {
  for (let i = 0; i < all.length; i++) {
    const token = all[i];
    // #[cfg(..)], #![cfg(..)], #[cfg_attr(.., ..)]
    if (token.text === "[" && (all[i - 1]?.text === "#" || (all[i - 1]?.text === "!" && all[i - 2]?.text === "#"))) {
      const name = all[i + 1];
      const group = all[i + 2];
      if (group?.text !== "(" || group.partner < 0) continue;
      if (name.text === "cfg") decide(all, i + 3, group.partner, edits, done);
      else if (name.text === "cfg_attr") decide(all, i + 3, firstComma(all, i + 3, group.partner), edits, done);
      continue;
    }
    // cfg!(..)
    if (token.text === "cfg" && all[i + 1]?.text === "!" && all[i + 2]?.text === "(" && all[i + 2].partner > 0) {
      decide(all, i + 3, all[i + 2].partner, edits, done);
      continue;
    }
    // cfg_select! { predicate => .., }
    if (
      token.text === "cfg_select" &&
      all[i + 1]?.text === "!" &&
      all[i + 2]?.kind === "open" &&
      all[i + 2].partner > 0
    ) {
      const end = all[i + 2].partner;
      let at = i + 3;
      while (at < end) {
        let arrow = at;
        while (arrow < end && !(all[arrow].text === "=" && all[arrow + 1]?.text === ">"))
          arrow = all[arrow].kind === "open" ? all[arrow].partner + 1 : arrow + 1;
        if (arrow >= end) break;
        decide(all, at, arrow, edits, done);
        const body = arrow + 2;
        if (all[body]?.text === "{") at = all[body].partner + 1;
        else at = firstComma(all, body, end);
        if (all[at]?.text === ",") at++;
      }
    }
  }
}

/** `fd.native()`: the image's `Fd` gives what the place asks for, and the code for one OS asks for one thing. */
function everyNative(all: Token[], edits: Edits, rules: Rules, done: Done) {
  const type = rules.os === "windows" ? "*mut ::core::ffi::c_void" : "i32";
  for (let i = 1; i + 2 < all.length; i++) {
    if (all[i].text !== "native" || all[i - 1].text !== "." || all[i + 1].text !== "(" || all[i + 1].partner !== i + 2)
      continue;
    edits.insert(all[i].end, `::<${type}>`);
    done.native++;
  }
}

/**
 * `long` has 32 bits on Windows and 64 in the image. In the code for Windows `c_long` and `c_ulong` are
 * the ones of Windows, `bun_windows_sys::{c_long, c_ulong}`, whatever module the source takes them from.
 */
function everyLong(all: Token[], edits: Edits, done: Done) {
  const isLong = (token: Token | undefined) =>
    token?.kind === "ident" && (token.text === "c_long" || token.text === "c_ulong");
  for (let i = 0; i < all.length; i++) {
    // use a::b::{.., c_long, ..};
    if (all[i].text === "use" && all[i].kind === "ident") {
      let end = i + 1;
      while (end < all.length && all[end].text !== ";") end = all[end].kind === "open" ? all[end].partner + 1 : end + 1;
      const group = all[end - 1]?.text === "}" ? all[end - 1].partner : -1;
      if (group > 0) {
        const moved: string[] = [];
        let entry = group + 1;
        while (entry < end - 1) {
          const comma = firstComma(all, entry, end - 1);
          if (isLong(all[entry]) && (comma === entry + 1 || all[entry + 1]?.text === "as")) {
            moved.push(
              all
                .slice(entry, comma)
                .map(token => token.text)
                .join(" "),
            );
            const until = comma < end - 1 ? all[comma].end : all[comma - 1].end;
            edits.replace(all[entry].start, until, "");
          }
          entry = comma + 1;
        }
        if (moved.length) {
          const visibility =
            all[i - 1]?.text === "pub"
              ? "pub "
              : all[i - 1]?.text === ")" && all[all[i - 1].partner - 1]?.text === "pub"
                ? "pub(crate) "
                : "";
          edits.insert(all[end].end, ` ${visibility}use ::bun_windows_sys::{${moved.join(", ")}};`);
          done.longs += moved.length;
        }
        i = end;
        continue;
      }
    }
    // a::b::c_long
    if (!isLong(all[i]) || all[i - 1]?.text !== ":" || all[i - 2]?.text !== ":") continue;
    let start = i - 2;
    while (all[start - 1]?.kind === "ident" && !["use", "as", "in"].includes(all[start - 1].text)) {
      start--;
      if (all[start - 1]?.text === ":" && all[start - 2]?.text === ":") start -= 2;
      else break;
    }
    if (all[start].text === "bun_windows_sys" || all[start + 2]?.text === "bun_windows_sys") continue;
    edits.replace(all[start].start, all[i].start, "::bun_windows_sys::");
    done.longs++;
  }
}

/** The start of the item that the token `at` is in the head of: its qualifiers, after its attributes. */
function headStart(all: Token[], at: number) {
  let i = at;
  for (;;) {
    const previous = all[i - 1];
    if (!previous) break;
    if (previous.kind === "ident" && ["unsafe", "const", "async", "pub", "default", "safe"].includes(previous.text))
      i--;
    else if (previous.text === ")" && all[previous.partner - 1]?.text === "pub") i = previous.partner - 1;
    else break;
  }
  return i;
}

/** The attributes in front of the item whose head starts at `head`: [index of `#`, index of `]`]. */
function attributesBefore(all: Token[], head: number) {
  const out: [number, number][] = [];
  let i = head;
  while (all[i - 1]?.text === "]" && all[i - 1].partner > 0 && all[all[i - 1].partner - 1]?.text === "#") {
    const open = all[i - 1].partner;
    out.unshift([open - 1, i - 1]);
    i = open - 1;
  }
  return out;
}

function exportsOf(all: Token[], edits: Edits | undefined, suffix: string, done: Done) {
  for (let i = 0; i < all.length; i++) {
    if (all[i].text !== "[" || all[i - 1]?.text !== "#" || all[i].partner < 0) continue;
    const close = all[i].partner;
    let inner = i + 1;
    let innerEnd = close;
    if (all[inner].text === "unsafe" && all[inner + 1]?.text === "(") {
      innerEnd = all[inner + 1].partner;
      inner += 2;
    }
    if (all[inner].text === "no_mangle" && innerEnd === inner + 1) {
      // The name is the one of the function or of the static that follows.
      let at = close + 1;
      while (
        at < all.length &&
        all[at].text !== "fn" &&
        all[at].text !== "static" &&
        all[at].text !== ";" &&
        all[at].text !== "{"
      )
        at = all[at].kind === "open" ? all[at].partner + 1 : at + 1;
      if (all[at]?.text !== "fn" && all[at]?.text !== "static") continue;
      let name = all[at + 1];
      if (name?.text === "mut") name = all[at + 2];
      // In the body of a macro the name is one of its variables.
      if (name?.text === "$" && all[all.indexOf(name) + 1]?.kind === "ident") {
        const variable = all[all.indexOf(name) + 1].text;
        edits?.replace(all[i].start, all[close].end, `[unsafe(export_name = concat!(stringify!($${variable}), "${suffix}"))]`);
        continue;
      }
      if (name?.kind !== "ident") continue;
      done.exports.push(name.text);
      edits?.replace(all[i].start, all[close].end, `[unsafe(export_name = "${name.text}${suffix}")]`);
    } else if (
      all[inner].text === "export_name" &&
      all[inner + 1]?.text === "=" &&
      all[inner + 2]?.kind === "literal"
    ) {
      const name = stringOf(all[inner + 2].text);
      done.exports.push(name);
      edits?.replace(all[inner + 2].start, all[inner + 2].end, `"${name}${suffix}"`);
    }
  }
}

const isLinkAttribute = (text: string) => /^#\s*\[\s*(cfg_attr\s*\((all\(\)|any\(\)|[^,]*),\s*)?link\s*\(/.test(text);

type ExternItem = {
  kind: "fn" | "static" | "other";
  name: string;
  symbol: string;
  /** The item, from its first attribute. */
  start: number;
  end: number;
  /** Where the item before it ends: its comments are between there and `start`. */
  after: number;
  linkName?: Token;
  variadic: boolean;
};

/** The items of an `extern` block, whose braces are at `open` and its partner. */
function externItems(all: Token[], open: number): ExternItem[] {
  const items: ExternItem[] = [];
  const close = all[open].partner;
  let at = open + 1;
  let after = all[open].end;
  while (at < close) {
    const first = at;
    let linkName: Token | undefined;
    // attributes
    while (all[at].text === "#" && all[at + 1]?.text === "[") {
      const end = all[at + 1].partner;
      if (all[at + 2].text === "link_name" && all[at + 4]?.kind === "literal") linkName = all[at + 4];
      at = end + 1;
    }
    let keyword = at;
    while (keyword < close && !["fn", "static", "type", ";"].includes(all[keyword].text))
      keyword = all[keyword].kind === "open" ? all[keyword].partner + 1 : keyword + 1;
    let end = keyword;
    while (end < close && all[end].text !== ";") end = all[end].kind === "open" ? all[end].partner + 1 : end + 1;
    const kind = all[keyword]?.text === "fn" ? "fn" : all[keyword]?.text === "static" ? "static" : "other";
    let nameToken = all[keyword + 1];
    if (kind === "static" && nameToken?.text === "mut") nameToken = all[keyword + 2];
    let variadic = false;
    if (kind === "fn") {
      const parameters = all.findIndex((t, index) => index > keyword && t.text === "(");
      if (parameters > 0 && parameters < end) {
        for (let i = parameters + 1; i + 2 < all[parameters].partner + 1; i++)
          if (all[i].text === "." && all[i + 1].text === "." && all[i + 2].text === ".") variadic = true;
      }
    }
    const name = nameToken?.kind === "ident" ? nameToken.text : "";
    const last = all[Math.min(end, close - 1)].end;
    items.push({
      kind: name ? kind : "other",
      name,
      symbol: linkName ? stringOf(linkName.text) : name,
      start: all[first].start,
      end: last,
      after,
      linkName,
      variadic,
    });
    after = last;
    at = end + 1;
  }
  return items;
}

function libraryOf(all: Token[], attributes: [number, number][]) {
  for (const [from, to] of attributes) {
    for (let i = from; i < to; i++) {
      if (all[i].text === "link" && all[i + 1]?.text === "(") {
        for (let k = i + 2; k < all[i + 1].partner; k++)
          if (all[k].text === "name" && all[k + 1]?.text === "=" && all[k + 2]?.kind === "literal")
            return stringOf(all[k + 2].text)
              .replace(/\.(dll|lib)$/i, "")
              .toLowerCase();
      }
    }
  }
  return "*";
}

/**
 * Whether a function that nothing of the image defines is one of Windows, of its C runtime or of libuv,
 * which the host resolves, and not a function of bun that this image was built without. The block that
 * declares it says so (`extern "system"`, `link(name = "..")`), or its name does: `uv_..`, `_name` of the
 * C runtime, a name of Win32 or of ntdll.
 */
function isOfTheHost(symbol: string, abi: string, namesLibrary: boolean) {
  if (namesLibrary || abi.startsWith('"system')) return true;
  if (/^uv_/.test(symbol) || /^_[a-z]/.test(symbol)) return true;
  return (
    /^[A-Z][A-Za-z0-9]*$/.test(symbol) && /[a-z]/.test(symbol) && !/^(Bun|JSC|WTF|Zig|Inspector|WebCore)/.test(symbol)
  );
}

/** `extern` blocks of the code for Windows: which function is the image's, the flavour's, the host's. */
function everyExternBlock(all: Token[], source: string, edits: Edits, rules: Rules, done: Done) {
  const suffix = `__${rules.os}`;
  for (let i = 0; i < all.length; i++) {
    if (all[i].text !== "extern") continue;
    let open = i + 1;
    let abi = '"C"';
    if (all[open]?.kind === "literal") {
      abi = all[open].text;
      open++;
    }
    if (all[open]?.text !== "{" || all[open].partner < 0) continue;
    const head = headStart(all, i);
    const attributes = attributesBefore(all, head);
    const attributeText = attributes.map(([from, to]) => source.slice(all[from].start, all[to].end));
    // A block that says itself what it imports.
    if (attributeText.some(text => /bun_portable_macros\s*::\s*imports/.test(text))) continue;
    const imported: ExternItem[] = [];
    const library = libraryOf(all, attributes);
    for (const item of externItems(all, open)) {
      // What the image defines once has one name. Everything else of the flavour for Windows, defined
      // by it or not, has the name of the flavour: the same name in the flavour for POSIX is another
      // function.
      if (item.kind === "other" || rules.os !== "windows" || rules.ofImage.has(item.symbol)) continue;
      if (abi !== '"Rust"' && item.kind === "fn" && !item.variadic && !rules.ofFlavour.has(item.symbol) && isOfTheHost(item.symbol, abi, library !== "*")) {
        imported.push(item);
        continue;
      }
      if (item.linkName) edits.replace(item.linkName.start, item.linkName.end, `"${item.symbol}${suffix}"`);
      else edits.insert(item.start, `#[link_name = "${item.symbol}${suffix}"]\n`);
      (rules.ofFlavour.has(item.symbol) ? done.renamed : done.missing).push(item.symbol);
    }
    // The image is not linked against a library of Windows: the host has them.
    if (rules.os === "windows")
      for (const [from, to] of attributes)
        if (isLinkAttribute(source.slice(all[from].start, all[to].end))) edits.replace(all[from].start, all[to].end, "");
    if (!imported.length) continue;
    const keptAttributes = attributeText.filter(text => !isLinkAttribute(text));
    let block = `\n${keptAttributes.join("\n")}\n#[bun_portable_macros::imports(library = "${library}")]\nunsafe extern ${abi} {\n`;
    for (const item of imported) {
      // With the comments in front of it.
      block += `    ${source.slice(item.after, item.end).trim()}\n`;
      edits.replace(item.after, item.end, "");
      done.imports.push({ symbol: item.symbol, library });
    }
    block += "}\n";
    edits.insert(all[all[open].partner].end, block);
  }
}

const namesOfLibuv = (text: string) =>
  /^(uv|libuv|bun_libuv_sys)$/.test(text) || /^uv_/.test(text) || /^UV_/.test(text);

/** What Windows and libuv call, and the types of pointers to it: the calling convention of Windows. */
function everyCallback(all: Token[], edits: Edits, rules: Rules, done: Done) {
  if (rules.os !== "windows") return;
  for (let i = 0; i < all.length; i++) {
    if (all[i].text !== "extern") continue;
    let at = i + 1;
    let abi: Token | undefined;
    if (all[at]?.kind === "literal") abi = all[at++];
    if (all[at]?.text !== "fn") continue;
    const abiName = abi ? stringOf(abi.text) : "C";
    if (!["C", "system", "C-unwind", "system-unwind"].includes(abiName)) continue;
    const isItem = all[at + 1]?.kind === "ident";
    let parameters = at + 1;
    while (parameters < all.length && all[parameters].text !== "(") parameters++;
    const close = all[parameters]?.partner ?? -1;
    if (close < 0) continue;
    // The result, up to what ends the signature.
    let end = close + 1;
    if (all[end]?.text === "-" && all[end + 1]?.text === ">") {
      end += 2;
      while (end < all.length && !["{", ";", ",", ")", "]", ">", "=", "where"].includes(all[end].text))
        end = all[end].kind === "open" ? all[end].partner + 1 : end + 1;
    }
    const ofWindows =
      abiName.startsWith("system") ||
      all.slice(parameters, end).some(token => token.kind === "ident" && namesOfLibuv(token.text));
    if (!ofWindows) continue;
    if (isItem) {
      const head = headStart(all, i);
      const attributes = attributesBefore(all, head);
      if (attributes.some(([from, to]) => all.slice(from, to).some(token => token.text === "win_abi"))) continue;
      // A function with a name for the linker is one that the C and C++ of the image call.
      if (attributes.some(([from, to]) => all.slice(from, to).some(token => token.text === "export_name" || token.text === "no_mangle")) && !abiName.startsWith("system")) continue;
      edits.insert(all[head].start, "#[bun_portable_macros::win_abi] ");
      done.callbacks.push(all[at + 1].text);
    } else if (rules.arch === "x86_64") {
      const name = abiName.endsWith("-unwind") ? '"win64-unwind"' : '"win64"';
      if (abi) edits.replace(abi.start, abi.end, name);
      else edits.insert(all[i].end, ` ${name}`);
      done.callbackTypes++;
    }
  }
}

/** A source file of a crate, as the flavour has it. One rule after the other, each on what the one before wrote. */
export function rewrite(source: string, rules: Rules, done: Done): string {
  const pass = (text: string, rule: (all: Token[], edits: Edits, text: string) => void) => {
    const edits = new Edits();
    rule(tokens(text), edits, text);
    return edits.count ? edits.apply(text) : text;
  };
  let text = source;
  if (rules.os === "windows") text = pass(text, (all, edits) => everyCfg(all, edits, done));
  if (rules.os === "windows") text = pass(text, (all, edits) => everyLong(all, edits, done));
  text = pass(text, (all, edits) => everyNative(all, edits, rules, done));
  text = pass(text, (all, edits) => exportsOf(all, rules.os === "windows" ? edits : undefined, `__${rules.os}`, done));
  text = pass(text, (all, edits) => everyCallback(all, edits, rules, done));
  text = pass(text, (all, edits, current) => everyExternBlock(all, current, edits, rules, done));
  return text;
}

// ---- crates ----

type Package = {
  name: string;
  version: string;
  id: string;
  manifest_path: string;
  edition: string;
  source: string | null;
  targets: { kind: string[]; name: string; src_path: string }[];
  dependencies: {
    name: string;
    rename: string | null;
    req: string;
    kind: string | null;
    target: string | null;
    features: string[];
    uses_default_features: boolean;
    path?: string;
    optional: boolean;
  }[];
};

function metadata(directory: string, locked = true) {
  const result = Bun.spawnSync(["cargo", "metadata", "--format-version", "1", ...(locked ? ["--locked"] : [])], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: 1 << 30,
  });
  if (result.exitCode !== 0) throw new Error(`cargo metadata in ${directory}: ${result.stderr.toString()}`);
  return JSON.parse(result.stdout.toString()) as { packages: Package[]; workspace_members: string[] };
}

/** Whether the image of the flavour has a dependency that is under `cfg(..)` in a manifest. */
function hasTarget(target: string | null, os: Os): boolean {
  if (!target) return true;
  const predicate = /^cfg\((.*)\)$/.exec(target)?.[1];
  if (predicate === undefined) return false;
  const evaluate = (text: string): boolean => {
    text = text.trim();
    const call = /^(all|any|not)\((.*)\)$/s.exec(text);
    if (call) {
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < call[2].length; i++) {
        const c = call[2][i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 0) {
          parts.push(call[2].slice(start, i));
          start = i + 1;
        }
      }
      parts.push(call[2].slice(start));
      const values = parts.filter(part => part.trim()).map(evaluate);
      return call[1] === "all" ? values.every(Boolean) : call[1] === "any" ? values.some(Boolean) : !values[0];
    }
    if (text === "bun_portable") return true;
    if (text === "windows") return os === "windows";
    if (text === "unix") return os !== "windows";
    const pair = /^([a-z_]+)\s*=\s*"([^"]*)"$/.exec(text);
    if (pair) {
      if (os === "windows") return windowsHas(pair[1], pair[2]) ?? false;
      if (pair[1] === "target_os") return pair[2] === "linux";
      if (pair[1] === "target_family") return pair[2] === "unix";
      if (pair[1] === "target_env") return pair[2] === "musl";
      if (pair[1] === "target_arch") return pair[2] === "x86_64";
    }
    return false;
  };
  return evaluate(predicate);
}

function filesOf(directory: string, out: string[] = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "target" || entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) filesOf(path, out);
    else out.push(path);
  }
  return out;
}

function definedIn(files: string[], nm: string) {
  const out = new Set<string>();
  for (const file of files) {
    const result = Bun.spawnSync([nm, "--defined-only", "-g", "--format=posix", file], {
      stdout: "pipe",
      stderr: "pipe",
      maxBuffer: 1 << 30,
    });
    if (result.exitCode !== 0) throw new Error(`${nm} ${file}: ${result.stderr.toString()}`);
    for (const line of result.stdout.toString().split("\n")) {
      const name = line.split(" ")[0];
      if (name && !name.endsWith(":")) out.add(name);
    }
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const option = (name: string, fallback?: string) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  const list = (name: string) => (option(name) ?? "").split(",").filter(Boolean);
  const os = option("os") as Os;
  if (os !== "windows" && os !== "posix") throw new Error("--os windows or posix");
  const out = resolve(option("out") ?? "");
  if (!option("out")) throw new Error("--out <dir>");
  const arch = option("arch", "x86_64")!;
  const nm = option("nm", "/usr/lib/llvm-current/bin/llvm-nm")!;
  const here = dirname(import.meta.path);
  const repo = resolve(here, "../../..");
  const suffix = `__${os}`;

  // The crates: the workspace of bun, and the ones that are given by their directory.
  const workspace = metadata(repo);
  const packages = new Map<string, Package>(workspace.packages.map(p => [p.name, p]));
  const members = new Set(workspace.workspace_members);
  const roots: string[] = [];
  for (const root of list("roots")) {
    if (!root.includes("/")) {
      roots.push(root);
      continue;
    }
    const directory = resolve(root);
    // A crate of its own workspace takes the versions that bun is built with.
    if (!existsSync(join(directory, "Cargo.lock"))) cpSync(join(repo, "Cargo.lock"), join(directory, "Cargo.lock"));
    const own = metadata(directory, false);
    const found = own.packages.find(p => dirname(p.manifest_path) === directory);
    if (!found) throw new Error(`${root}: no crate`);
    packages.set(found.name, found);
    members.add(found.id);
    roots.push(found.name);
  }
  const isOurs = (name: string) => {
    const p = packages.get(name);
    return p !== undefined && p.source === null;
  };
  const dependenciesOf = (name: string) =>
    packages
      .get(name)!
      .dependencies.filter(
        d => d.kind !== "dev" && !d.optional && (hasTarget(d.target, os) || hasTarget(d.target, "posix")),
      )
      .filter(d => packages.has(d.name));
  const closure = new Set<string>();
  const walk = (name: string) => {
    if (closure.has(name)) return;
    closure.add(name);
    for (const d of dependenciesOf(name)) if (isOurs(d.name)) walk(d.name);
  };
  roots.forEach(walk);
  const flavoured = new Set(list("seeds").filter(seed => closure.has(seed)));
  for (const root of list("roots")) if (root.includes("/")) flavoured.add(roots[list("roots").indexOf(root)]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of closure) {
      if (flavoured.has(name)) continue;
      if (dependenciesOf(name).some(d => flavoured.has(d.name))) {
        flavoured.add(name);
        changed = true;
      }
    }
  }
  for (const name of flavoured) {
    const kinds = packages.get(name)!.targets.flatMap(t => t.kind);
    if (kinds.includes("proc-macro")) throw new Error(`${name} is a proc macro and would have a flavour`);
  }

  // Symbols. What the crates without a flavour export is the image's, like what its C code defines.
  const ofImage = definedIn(list("defined-in"), nm);
  const ofFlavour = definedIn(list("flavoured-c"), nm);
  for (const name of closure) {
    const directory = dirname(packages.get(name)!.manifest_path);
    for (const file of filesOf(directory)) {
      if (!file.endsWith(".rs")) continue;
      const found = newDone();
      exportsOf(tokens(readFileSync(file, "utf8")), undefined, "", found);
      for (const symbol of found.exports) (flavoured.has(name) ? ofFlavour : ofImage).add(symbol);
    }
  }
  const rules: Rules = { os, arch, ofFlavour: os === "windows" ? ofFlavour : new Set(), ofImage };

  const report: Record<string, unknown> = {};
  rmSync(join(out, os), { recursive: true, force: true });
  for (const name of [...flavoured].sort()) {
    const p = packages.get(name)!;
    const from = dirname(p.manifest_path);
    const to = join(out, os, name);
    const done = newDone();
    let files = 0;
    for (const file of filesOf(from)) {
      const target = join(to, relative(from, file));
      mkdirSync(dirname(target), { recursive: true });
      if (basename(file) === "Cargo.toml" || basename(file) === "Cargo.lock") continue;
      if (file.endsWith(".rs")) {
        writeFileSync(target, rewrite(readFileSync(file, "utf8"), rules, done));
        files++;
      } else cpSync(file, target);
    }
    if (existsSync(join(from, "build.rs")))
      throw new Error(`${name} has a build script: flavor.ts writes the one of a flavour`);
    writeFileSync(
      join(to, "build.rs"),
      `// Written by misctools/portable/loop/flavor.ts.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rustc-env=BUN_PORTABLE_FLAVOR=${os === "windows" ? suffix : ""}");
    println!("cargo:rustc-check-cfg=cfg(bun_flavor, values(\\"windows\\", \\"posix\\"))");
    println!("cargo:rustc-cfg=bun_flavor=\\"${os}\\"");
}
`,
    );
    const library = p.targets.find(t => t.kind.some(kind => kind.endsWith("lib")));
    if (!library) throw new Error(`${name} has no library`);
    const lines = [
      `# Written by misctools/portable/loop/flavor.ts: ${name} of bun as the portable image has it for ${os}.`,
      `[package]`,
      `name = "${name}${suffix}"`,
      `version = "${p.version}"`,
      `edition = "${p.edition}"`,
      `build = "build.rs"`,
      ``,
      `[lib]`,
      `name = "${library.name}"`,
      `path = "${relative(from, library.src_path)}"`,
      ``,
      `[lints.rust]`,
      `unexpected_cfgs = { level = "allow" }`,
      ``,
      `[dependencies]`,
    ];
    const written = new Set<string>();
    const dependency = (
      key: string,
      d: { name: string; req: string; features: string[]; uses_default_features: boolean; path?: string },
    ) => {
      if (written.has(key)) return;
      written.add(key);
      const parts: string[] = [];
      if (flavoured.has(d.name)) parts.push(`package = "${d.name}${suffix}"`, `path = "../${d.name}"`);
      else if (d.path) {
        if (key !== d.name) parts.push(`package = "${d.name}"`);
        parts.push(`path = "${d.path}"`);
      } else {
        if (key !== d.name) parts.push(`package = "${d.name}"`);
        parts.push(`version = "${d.req}"`);
      }
      if (!d.uses_default_features) parts.push("default-features = false");
      if (d.features.length) parts.push(`features = [${d.features.map(f => `"${f}"`).join(", ")}]`);
      lines.push(`${key} = { ${parts.join(", ")} }`);
    };
    for (const d of p.dependencies) {
      if (d.kind === "dev" || d.kind === "build" || d.optional) continue;
      if (!hasTarget(d.target, os)) continue;
      dependency(d.rename ?? d.name, d);
    }
    // What the rewritten source names.
    for (const extra of ["bun_portable_macros", "bun_windows_sys"]) {
      const found = packages.get(extra)!;
      dependency(extra, {
        name: extra,
        req: "*",
        features: [],
        uses_default_features: true,
        path: dirname(found.manifest_path),
      });
    }
    writeFileSync(join(to, "Cargo.toml"), lines.join("\n") + "\n");
    report[name] = {
      files,
      ...done,
      exports: [...new Set(done.exports)].sort(),
      renamed: [...new Set(done.renamed)].sort(),
      missing: [...new Set(done.missing)].sort(),
    };
  }
  mkdirSync(join(out, os), { recursive: true });
  writeFileSync(
    join(out, os, "flavor.json"),
    JSON.stringify(
      {
        os,
        flavoured: [...flavoured].sort(),
        once: [...closure].filter(name => !flavoured.has(name)).sort(),
        symbols_of_the_flavour: [...ofFlavour].sort(),
        symbols_of_the_image: [...ofImage].sort(),
        crates: report,
      },
      null,
      1,
    ) + "\n",
  );
  const total = Object.values(report as Record<string, Done & { files: number }>).reduce(
    (sum, r) => ({
      files: sum.files + r.files,
      cfg: sum.cfg + r.cfg,
      native: sum.native + r.native,
      imports: sum.imports + r.imports.length,
      callbacks: sum.callbacks + r.callbacks.length,
    }),
    { files: 0, cfg: 0, native: 0, imports: 0, callbacks: 0 },
  );
  console.log(`${os}: ${flavoured.size} crates (${[...flavoured].sort().join(" ")}), ${JSON.stringify(total)}`);
}
