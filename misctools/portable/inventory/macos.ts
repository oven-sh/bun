// The inventory of bun's code for macOS, for the portable image.
//
//   bun macos.ts [--out macos.json] [--summary]
//
// Reads the Rust sources of the crates below and writes, as data, every place where the source has code
// for macOS that is not its code for Linux, with what that code uses of the system, and which of three
// kinds it is:
//
//   K1  source that Linux and macOS share (`cfg(unix)`, `cfg(not(windows))`, or no `cfg`). The image
//       compiles it once, against its own libc, and the host of macOS answers the requests of that
//       libc. Listed: the functions, and for each whether the host answers what it asks.
//   K2  source for macOS only. In the image it has to be compiled next to the code for Linux, picked
//       when the image runs, and its functions are functions of macOS, bound through the import table.
//   K3  shared source that hands a number or a structure to the system, or takes one from it, that
//       macOS and Linux define differently, where the host does not translate it. Also: what bun
//       decides when it is compiled (`cfg!`, `bun_core::env::IS_LINUX`) and what it keeps in tables of
//       its own with one definition for each OS.
//
// A place is named by file and line. `active` says for which targets the compiler sees it in a release
// build; `in_image` is the target of the image (Linux, musl, `bun_portable`).
//
// Where the facts come from:
//   the sources of bun           this tree
//   the `libc` crate             rustdoc, for the targets of macOS and of the image (../bindings/libc-facts.ts)
//   the libc of the image        the patched musl tree under WORK/musl-<arch>/musl (../build.sh)
//   the host                     ../host/host_posix.c
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type Predicate, type Site, type Target, type Token, and, differs, enclosingFunction, holds, moduleDeclarations, show, sites, targets, tokens } from "./rust-scan.ts";
import { type Facts, type Item, explicit, load as loadLibc, rust as rustType } from "../bindings/libc-facts.ts";
import { type Arch, Musl, answeredTheWayOfLinux, hostAnswers, muslRoot } from "./requests.ts";

const here = dirname(import.meta.path);
const repo = resolve(here, "../../..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const args = process.argv.slice(2);
const outPath = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(here, "macos.json");

const crates: { name: string; dir: string; root: string }[] = [
  { name: "bun_core", dir: "src/bun_core", root: "lib.rs" },
  { name: "bun_sys", dir: "src/sys", root: "lib.rs" },
  { name: "bun_paths", dir: "src/paths", root: "lib.rs" },
  { name: "bun_io", dir: "src/io", root: "lib.rs" },
  { name: "bun_spawn", dir: "src/spawn", root: "lib.rs" },
  { name: "bun_spawn_sys", dir: "src/spawn_sys", root: "lib.rs" },
  { name: "bun_threading", dir: "src/threading", root: "lib.rs" },
  { name: "bun_watcher", dir: "src/watcher", root: "lib.rs" },
  { name: "bun_event_loop", dir: "src/event_loop", root: "lib.rs" },
  { name: "bun_errno", dir: "src/errno", root: "lib.rs" },
];

const T = targets;
type Active = { linux: boolean; macos: boolean; windows: boolean; image: boolean; macos_x86_64_only?: boolean; macos_aarch64_only?: boolean };
function activeOf(p: Predicate): Active {
  const macX = holds(p, T["macos-x86_64"]);
  const macA = holds(p, T["macos-aarch64"]);
  const out: Active = {
    linux: holds(p, T["linux-x86_64"]) || holds(p, T["linux-aarch64"]),
    macos: macX || macA,
    windows: holds(p, T["windows-x86_64"]),
    image: holds(p, T["image-x86_64"]) || holds(p, T["image-aarch64"]),
  };
  if (macX && !macA) out.macos_x86_64_only = true;
  if (macA && !macX) out.macos_aarch64_only = true;
  return out;
}
const differsForMac = (p: Predicate) => differs(p, T["macos-x86_64"], T["linux-x86_64"]) || differs(p, T["macos-aarch64"], T["linux-aarch64"]);

// ── the files of a crate, each with the predicate of the `mod` declarations that lead to it ──

type SourceFile = { crate: string; path: string; predicate: Predicate; list: Token[]; all: Site[]; effective: Map<Site, Predicate> };

function loadCrate(crate: (typeof crates)[number]): SourceFile[] {
  const out: SourceFile[] = [];
  const seen = new Set<string>();
  const visit = (path: string, predicate: Predicate, moduleDir: string) => {
    if (seen.has(path) || !existsSync(path)) return;
    seen.add(path);
    const list = tokens(readFileSync(path, "utf8"));
    const all = sites(list);
    const file: SourceFile = { crate: crate.name, path: relative(repo, path), predicate, list, all, effective: new Map() };
    const inner = all.filter(site => site.kind === "inner").map(site => site.predicate);
    const filePredicate = and([predicate, ...inner].filter(p => p.op !== "true"));
    file.predicate = filePredicate;
    // The sites in the order of their start: a stack gives the ones around each.
    const ordered = all.filter(site => site.kind !== "inner" && site.kind !== "host_libc").sort((a, b) => a.start - b.start || b.end - a.end);
    const stack: Site[] = [];
    for (const site of ordered) {
      while (stack.length && stack[stack.length - 1].end < site.start) stack.pop();
      const around = stack.filter(s => s.kind !== "cfg!").map(s => s.predicate);
      file.effective.set(site, and([filePredicate, ...around, site.predicate].filter(p => p.op !== "true")));
      if (site.kind !== "cfg!") stack.push(site);
    }
    out.push(file);
    for (const declaration of moduleDeclarations(list, all)) {
      const around = ordered.filter(site => site.kind === "attribute" && declaration.tokenIndex >= site.start && declaration.tokenIndex <= site.end).map(site => site.predicate);
      const modulePredicate = and([filePredicate, ...around].filter(p => p.op !== "true"));
      const dir = dirname(path);
      const candidates: { path: string; predicate: Predicate }[] = [];
      for (const conditional of declaration.conditionalPaths) candidates.push({ path: join(dir, conditional.path), predicate: and([modulePredicate, conditional.predicate]) });
      if (declaration.path) candidates.push({ path: join(dir, declaration.path), predicate: modulePredicate });
      else if (!declaration.conditionalPaths.length) {
        for (const base of [moduleDir, dir]) {
          candidates.push({ path: join(base, `${declaration.name}.rs`), predicate: modulePredicate });
          candidates.push({ path: join(base, declaration.name, "mod.rs"), predicate: modulePredicate });
        }
      }
      for (const candidate of candidates) {
        if (!existsSync(candidate.path)) continue;
        const isModRs = candidate.path.endsWith("/mod.rs");
        visit(candidate.path, candidate.predicate, isModRs ? dirname(candidate.path) : join(dirname(candidate.path), declaration.name));
        break;
      }
    }
  };
  visit(join(repo, crate.dir, crate.root), { op: "true" }, join(repo, crate.dir));
  return out;
}

// ── what a range of tokens uses of the system ──

type Use = { name: string; line: number; called: boolean; via: string; commands?: string[] };
type Declared = { name: string; symbol: string; line: number; variadic: boolean; arguments: string[]; result: string; safe: boolean };

/** `libc::NAME`, and the names of a `use libc::{..}`. */
function libcUses(list: Token[], from: number, to: number, skip: (index: number) => boolean): Use[] {
  const out: Use[] = [];
  for (let i = from; i <= to; i++) {
    if (skip(i)) continue;
    const t = list[i];
    if (t.kind !== "ident" || t.text !== "libc" || list[i + 1]?.text !== "::") continue;
    if (list[i - 1]?.text === "::" && list[i - 2]?.kind === "ident") continue;
    const next = list[i + 2];
    if (!next) continue;
    if (next.kind === "open" && next.text === "{") {
      const close = next.partner ?? i;
      for (let k = i + 3; k < close; k++) if (list[k].kind === "ident" && list[k + 1]?.text !== "::" && list[k - 1]?.text !== "as") out.push({ name: list[k].text, line: list[k].line, called: false, via: "use libc::{..}" });
      i = close;
      continue;
    }
    if (next.kind === "ident") {
      const called = list[i + 3]?.text === "(";
      const use: Use = { name: next.text, line: next.line, called, via: "libc::" };
      // The commands of a call of fcntl or ioctl: the constants between its brackets.
      if (called && (next.text === "fcntl" || next.text === "ioctl")) {
        use.commands = [];
        for (let k = i + 4; k < (list[i + 3].partner ?? i); k++) if (list[k].kind === "ident" && /^(F_[A-Z_]+|TIOC[A-Z]+|FIO[A-Z]+|TC[A-Z]+)$/.test(list[k].text)) use.commands.push(list[k].text);
      }
      out.push(use);
    }
  }
  return out;
}

/** The functions of the `extern` blocks in the range. */
function declaredFunctions(list: Token[], from: number, to: number, skip: (index: number) => boolean): Declared[] {
  const out: Declared[] = [];
  // A range inside of an `extern` block: the block that is around its first token.
  const blocks: { open: number; close: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind !== "ident" || list[i].text !== "extern") continue;
    let at = i + 1;
    if (list[at]?.kind === "literal") at++;
    const open = list[at];
    if (open?.kind !== "open" || open.text !== "{") continue;
    const close = open.partner ?? list.length - 1;
    if (close >= from && at <= to) blocks.push({ open: at, close });
    i = close;
  }
  for (const block of blocks) {
    const at = block.open;
    const close = block.close;
    let symbol: string | undefined;
    for (let k = Math.max(at + 1, from); k < close && k <= to; k++) {
      const t = list[k];
      if (skip(k)) continue;
      if (t.text === "#" && list[k + 1]?.text === "[") {
        const end = list[k + 1].partner!;
        if (list[k + 2]?.text === "link_name") symbol = JSON.parse(list[k + 4].text);
        k = end;
        continue;
      }
      if (t.kind === "ident" && t.text === "fn" && list[k + 1]?.kind === "ident" && list[k + 2]?.text === "(") {
        const parameters = list[k + 2];
        const end = parameters.partner!;
        const argumentsOf: string[] = [];
        let current: string[] = [];
        let variadic = false;
        let depth = 0;
        for (let a = k + 3; a < end; a++) {
          const s = list[a];
          if (s.kind === "open") depth++;
          if (s.kind === "close") depth--;
          if (s.text === "," && depth === 0) {
            if (current.length) argumentsOf.push(current.join(" "));
            current = [];
            continue;
          }
          current.push(s.text);
        }
        if (current.length) argumentsOf.push(current.join(" "));
        const cleaned = argumentsOf
          .filter(argument => {
            if (/^\.\s*\.\s*\.?$|^\.\.\s*\.$|^\.\.\.$/.test(argument.replace(/\s/g, "")) || argument.replace(/\s/g, "") === "...") {
              variadic = true;
              return false;
            }
            return true;
          })
          .map(argument => argument.replace(/^[A-Za-z_0-9]+ : /, "").replace(/ :: /g, "::").replace(/\* (const|mut) /g, "*$1 "));
        let result = "";
        let r = end + 1;
        if (list[r]?.text === "->") {
          const parts: string[] = [];
          for (r = r + 1; r < close && list[r].text !== ";"; r++) parts.push(list[r].text);
          result = parts.join(" ").replace(/ :: /g, "::").replace(/\* (const|mut) /g, "*$1 ");
        }
        let safe = false;
        for (let b = k - 1; b > at && list[b].kind === "ident" && ["pub", "safe", "unsafe"].includes(list[b].text); b--) if (list[b].text === "safe") safe = true;
        out.push({ name: list[k + 1].text, symbol: symbol ?? list[k + 1].text, line: t.line, variadic, arguments: cleaned, result, safe });
        symbol = undefined;
        k = end;
      }
    }
  }
  return out;
}

/** Names that bun decides with when it is compiled. */
const compileTimeNames = new Set(["IS_MAC", "IS_LINUX", "IS_KQUEUE", "IS_POSIX", "IS_MUSL", "IS_ANDROID", "IS_FREEBSD", "OS_NAME", "OS_NAME_NPM", "OS_NAME_NODE"]);

// ── the run ──

const files = crates.flatMap(loadCrate);
const libcMac = { x86_64: loadLibc("x86_64-apple-darwin", work), aarch64: loadLibc("aarch64-apple-darwin", work) };
const libcImage = { x86_64: loadLibc("x86_64-unknown-linux-musl", work), aarch64: loadLibc("aarch64-unknown-linux-musl", work) };
const libcLinuxGnu = loadLibc("x86_64-unknown-linux-gnu", work);

type Resolved = {
  name: string;
  macos?: { kind: string; value?: string; file: string; variadic?: boolean; aarch64_differs?: boolean };
  image?: { kind: string; value?: string };
  linux_gnu?: { kind: string; value?: string };
  /** The function, the type or the constant is one of macOS and not one of Linux. */
  macos_only: boolean;
  /** A constant with another value, or a structure with other fields, for macOS than for the image. */
  differs: boolean;
};
const pick = (facts: Facts, name: string, called: boolean): Item | undefined => {
  const list = facts.byName.get(name);
  if (!list) return undefined;
  return (called ? list.find(item => item.kind === "function") : list.find(item => item.kind !== "function")) ?? list[0];
};
const layout = (facts: Facts, item: Item) => (item.fields ?? []).map(field => `${field.name}: ${rustType(explicit(facts, field.type))}`).join("; ");
const resolved = new Map<string, Resolved>();
function resolve_(name: string, called: boolean): Resolved {
  const key = `${name}${called ? "()" : ""}`;
  const cached = resolved.get(key);
  if (cached) return cached;
  const mac = pick(libcMac.aarch64, name, called);
  const macX = pick(libcMac.x86_64, name, called);
  const image = pick(libcImage.x86_64, name, called);
  const gnu = pick(libcLinuxGnu, name, called);
  const describe = (facts: Facts, item: Item | undefined) =>
    item && {
      kind: item.kind,
      value: item.kind === "constant" ? (item.number ?? item.value) : item.kind === "struct" || item.kind === "union" ? layout(facts, item) : item.kind === "type_alias" ? rustType(explicit(facts, item.type!)) : undefined,
    };
  const m = describe(libcMac.aarch64, mac);
  const mx = describe(libcMac.x86_64, macX);
  const i = describe(libcImage.x86_64, image);
  const out: Resolved = {
    name,
    macos: (mac ?? macX) && { kind: (mac ?? macX)!.kind, value: (m ?? mx)?.value, file: (mac ?? macX)!.file, variadic: (mac ?? macX)!.variadic, aarch64_differs: !!m && !!mx && m.value !== mx.value },
    image: i,
    linux_gnu: describe(libcLinuxGnu, gnu),
    macos_only: !!(mac ?? macX) && !image && !gnu,
    differs: !!(m ?? mx) && !!i && (m ?? mx)!.kind !== "function" && (m ?? mx)!.value !== i.value,
  };
  resolved.set(key, out);
  return out;
}

type Place = {
  crate: string;
  file: string;
  line: number;
  end_line: number;
  item: string;
  in_function?: string;
  cfg: string;
  effective: string;
  active: Active;
  same_source_serves_linux: boolean;
  side: "macos" | "linux" | "both";
  kind: "K1" | "K2" | "K3" | "linux-only";
  /** How far the place is in the image: compiled there or not, and through which macro of the portable image. */
  in_image: string;
  functions: { name: string; symbol?: string; from: string; variadic?: boolean; macos_only?: boolean; line: number }[];
  types: { name: string; from: string; differs?: boolean }[];
  constants: { name: string; from: string; macos?: string; image?: string; differs?: boolean }[];
  note?: string;
};

const places: Place[] = [];
/** Every use of the libc in source that Linux and macOS share. */
const sharedUses: { file: string; line: number; name: string; called: boolean; in_function?: string; commands?: string[]; hostLibc?: boolean }[] = [];
const sharedDeclared: { file: string; declared: Declared }[] = [];
const decisions: { file: string; line: number; what: string; in_function?: string; in_image: boolean }[] = [];
/** Items that have one definition for macOS and one for Linux: `const`, `static`, `type`. */
const perOs = new Map<string, { file: string; item: string; macos: { line: number; text: string }[]; linux: { line: number; text: string }[] }>();

const textOf = (list: Token[], from: number, to: number) =>
  list
    .slice(from, to + 1)
    .map(t => t.text)
    .join(" ")
    .replace(/ :: /g, "::")
    .replace(/ \( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/ ;/g, ";")
    .replace(/ ,/g, ",");

for (const file of files) {
  const { list, all } = file;
  // The innermost site of every token.
  const innermost: (Site | undefined)[] = new Array(list.length).fill(undefined);
  const ordered = all.filter(site => site.kind === "attribute" || site.kind === "host_select").sort((a, b) => a.start - b.start || b.end - a.end);
  for (const site of ordered) for (let i = site.attributeStart; i <= site.end; i++) innermost[i] = site;
  // What is inside of host_libc!: on a macOS host the image calls the function of macOS for it.
  const throughHostLibc: boolean[] = new Array(list.length).fill(false);
  for (const site of all.filter(site => site.kind === "host_libc")) for (let i = site.start; i <= site.end; i++) throughHostLibc[i] = true;
  // An arm of host_select! that the image has, whatever its `cfg` says for the target of the image.
  const imageHas = (site: Site, active: Active): boolean => {
    let has = active.image;
    for (const around of ordered) {
      if (around.kind !== "host_select" || around.start > site.start || around.end < site.end) continue;
      if (around.inImage === "no") return false;
      has = true;
    }
    return has;
  };
  const predicateAt = (index: number) => (innermost[index] ? file.effective.get(innermost[index]!)! : file.predicate);
  const cache = new Map<Predicate, Active>();
  const activeAt = (index: number) => {
    const p = predicateAt(index);
    let a = cache.get(p);
    if (!a) cache.set(p, (a = activeOf(p)));
    return a;
  };
  const portableMacros = (site: Site) => site.attributes.filter(a => /bun_portable_macros::|host_os\(|flavor\(/.test(a)).map(a => a.replace(/^cfg_attr\(bun_portable, ?/, "").replace(/\)$/, ""));

  for (const site of ordered) {
    const effective = file.effective.get(site)!;
    if (!differsForMac(effective) && !differsForMac(site.predicate)) continue;
    const active = activeOf(effective);
    if (active.macos === active.linux && !differsForMac(effective)) continue;
    const side: Place["side"] = active.macos && !active.linux ? "macos" : active.linux && !active.macos ? "linux" : "both";
    if (side === "both") continue;
    if (!active.macos && !active.linux) continue;
    // Tokens of the place itself: not the ones of a site inside of it that is not for this side.
    const own = (index: number) => {
      const a = activeAt(index);
      return side === "macos" ? a.macos : a.linux;
    };
    const skip = (index: number) => !own(index);
    const uses = libcUses(list, site.start, site.end, skip);
    const declared = declaredFunctions(list, site.attributeStart, site.end, skip);
    const functions: Place["functions"] = [];
    const types: Place["types"] = [];
    const constants: Place["constants"] = [];
    const seen = new Set<string>();
    for (const use of uses) {
      const r = resolve_(use.name, use.called);
      const target = side === "macos" ? r.macos : (r.linux_gnu ?? r.image);
      const kind = target?.kind ?? (use.called ? "function" : /^[A-Z0-9_]+$/.test(use.name) ? "constant" : "type");
      const key = `${kind} ${use.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (kind === "function" || kind === "static") functions.push({ name: use.name, from: "libc crate", variadic: r.macos?.variadic, macos_only: side === "macos" ? r.macos_only : undefined, line: use.line });
      else if (kind === "constant") constants.push({ name: use.name, from: "libc crate", macos: r.macos?.value, image: r.image?.value, differs: r.differs || undefined });
      else types.push({ name: use.name, from: "libc crate", differs: r.differs || undefined });
    }
    for (const d of declared) functions.push({ name: d.name, symbol: d.symbol !== d.name ? d.symbol : undefined, from: "declared by bun", variadic: d.variadic || undefined, line: d.line });
    const macros = portableMacros(site);
    active.image = imageHas(site, active);
    places.push({
      crate: file.crate,
      file: file.path,
      line: site.line,
      end_line: site.endLine,
      item: site.item,
      in_function: ["block", "statement", "arm", "expression"].includes(site.item) || site.item.startsWith("let ") || site.item.endsWith(" statement") ? enclosingFunction(list, site.start) : undefined,
      cfg: site.written,
      effective: show(effective),
      active,
      same_source_serves_linux: false,
      side,
      kind: side === "macos" ? "K2" : "linux-only",
      in_image: active.image ? (macros.length ? `compiled into the image (${macros.join(", ")})` : "compiled into the image") : "not in the image",
      functions,
      types,
      constants,
      note: side === "macos" && !functions.length ? "no function of the system: data or logic" : undefined,
    });
    // One definition for each OS of the same item.
    if (/^(const|static|type) /.test(site.item)) {
      const key = `${file.path} ${site.item} ${enclosingFunction(list, site.start) ?? ""}`;
      const entry = perOs.get(key) ?? { file: file.path, item: site.item, macos: [], linux: [] };
      entry[side].push({ line: site.line, text: textOf(list, site.start, Math.min(site.end, site.start + 40)) });
      perOs.set(key, entry);
    }
  }

  // `cfg!(..)` that macOS and Linux answer differently, and the constants of bun_core::env.
  for (const site of all.filter(s => s.kind === "cfg!")) {
    if (!differsForMac(site.predicate)) continue;
    const a = activeAt(site.start);
    if (!a.macos && !a.linux) continue;
    decisions.push({ file: file.path, line: site.line, what: `cfg!(${site.written})`, in_function: enclosingFunction(list, site.start), in_image: a.image });
  }
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind !== "ident" || !compileTimeNames.has(t.text)) continue;
    if (list[i - 1]?.text === "const" || list[i - 1]?.text === "pub") continue;
    const a = activeAt(i);
    if (!(a.macos || a.linux)) continue;
    if (file.path === "src/bun_core/env.rs" && list[i + 1]?.text === ":") continue;
    decisions.push({ file: file.path, line: t.line, what: `bun_core::env::${t.text}`, in_function: enclosingFunction(list, i), in_image: a.image });
  }

  // What shared source uses of the libc.
  const shared = (index: number) => {
    const a = activeAt(index);
    return a.macos && a.linux;
  };
  for (const use of libcUses(list, 0, list.length - 1, index => !shared(index))) {
    const index = list.findIndex(t => t.line === use.line && t.text === use.name);
    sharedUses.push({ file: file.path, line: use.line, name: use.name, called: use.called, commands: use.commands, hostLibc: index >= 0 && throughHostLibc[index] });
  }
  for (const declared of declaredFunctions(list, 0, list.length - 1, index => !shared(index))) sharedDeclared.push({ file: file.path, declared });
}

// ── K1: the functions that shared source calls, and the host ──

const hostSource = join(here, "../host/host_posix.c");
const answers = hostAnswers(hostSource);
const musl: Partial<Record<Arch, Musl>> = {};
for (const arch of ["x86_64", "aarch64"] as Arch[]) {
  const root = muslRoot(work, arch) ?? muslRoot(work, "x86_64");
  if (root) musl[arch] = new Musl(root, arch);
}

type K1Function = {
  name: string;
  declared_by: "libc crate" | "bun";
  used_in: string[];
  uses: number;
  /** What the libc of the image asks of the host for it, for each architecture of the image. */
  requests: Record<string, { own: string[]; through: Record<string, string[]>; commands: string[] }>;
  /** fcntl and ioctl: the commands that bun passes where it calls the function. */
  commands_of_bun: string[];
  /** Places where the call is inside of bun_core::host_libc!: on a macOS host the image calls the function of macOS. */
  through_host_libc: number;
  host: "answers" | "answers in part" | "does not answer" | "no request: the libc of the image does it" | "not a function of the libc of the image" | "not a function of the system: bun or a library of the image";
  not_answered: string[];
  notes: string[];
};
const k1 = new Map<string, K1Function>();
const addK1 = (name: string, declaredBy: K1Function["declared_by"], file: string, line: number, commands: string[] = [], hostLibc = false) => {
  const entry = k1.get(name) ?? { name, declared_by: declaredBy, used_in: [], uses: 0, requests: {}, commands_of_bun: [], through_host_libc: 0, host: "no request: the libc of the image does it", not_answered: [], notes: [] };
  entry.uses++;
  if (hostLibc) entry.through_host_libc++;
  for (const command of commands) if (!entry.commands_of_bun.includes(command)) entry.commands_of_bun.push(command);
  const where = `${file}:${line}`;
  if (entry.used_in.length < 6) entry.used_in.push(where);
  k1.set(name, entry);
};
for (const use of sharedUses) {
  const r = resolve_(use.name, use.called);
  const isFunction = (r.image?.kind ?? r.macos?.kind) === "function" || (use.called && !r.image && !r.macos);
  if (isFunction && use.called) addK1(use.name, "libc crate", use.file, use.line, use.commands, use.hostLibc);
  else if (isFunction && !use.called && libcImage.x86_64.byName.get(use.name)?.every(item => item.kind === "function")) addK1(use.name, "libc crate", use.file, use.line);
}
for (const { file, declared } of sharedDeclared) addK1(declared.symbol, "bun", file, declared.line);
for (const entry of k1.values()) {
  let any = false;
  const missing = new Set<string>();
  const partial = new Set<string>();
  let known = false;
  for (const arch of ["x86_64", "aarch64"] as Arch[]) {
    const m = musl[arch];
    if (!m || !m.has(entry.name)) continue;
    known = true;
    const found = m.requests(entry.name);
    entry.requests[arch] = found;
    for (const request of [...found.own, ...Object.values(found.through).flat()]) {
      any = true;
      const answer = answers.get(request);
      if (!answer || !answer.macos) missing.add(request);
      else if (answer.commands) {
        // A request with commands: the ones that the function of the libc passes, or bun where it calls it.
        const prefix = request === "fcntl" ? /^F_/ : request === "ioctl" ? /^(TIOC|FIO|TC)/ : request === "prctl" ? /^PR_/ : /^MADV_/;
        const same = request === entry.name;
        const used = (same ? entry.commands_of_bun : found.commands).filter(command => prefix.test(command) && !/^F_(RDLCK|WRLCK|UNLCK|OK)$/.test(command));
        const unknown = used.filter(command => !answer.commands!.includes(command));
        if (unknown.length) partial.add(`${request}: not ${unknown.join(", ")}`);
        else if (same && !used.length) partial.add(`${request}: ${answer.note}; the commands of bun are not constants at the call`);
      }
    }
  }
  // A function of the libc asks for the request of its own name, and for older ones only after the host
  // said that it does not know that one (utimensat: futimesat, utimes).
  if (answers.get(entry.name.replace(/^_+/, ""))?.macos || Object.keys(entry.requests).some(arch => Object.keys(entry.requests[arch].through).some(callee => answers.get(callee.replace(/^_+/, ""))?.macos && entry.requests[arch].through[callee].every(request => missing.has(request) || answers.get(request)?.macos))))
    for (const request of [...missing]) {
      const own = Object.values(entry.requests).some(found => found.own.includes(request) && found.own.includes(entry.name.replace(/^_+/, "")));
      const ofCallee = Object.values(entry.requests).some(found => Object.entries(found.through).some(([callee, list]) => list.includes(request) && answers.get(callee.replace(/^_+/, ""))?.macos));
      if (own || ofCallee) {
        missing.delete(request);
        partial.add(`${request}: asked only after the host refused the request that it answers`);
      }
    }
  if (entry.through_host_libc === entry.uses) {
    for (const request of missing) partial.add(`${request}: not asked on a macOS host, where the image calls the function of macOS (host_libc!)`);
    missing.clear();
  }
  entry.not_answered = [...missing].sort();
  entry.notes = [...partial].sort();
  const ofTheSystem = [libcMac.aarch64, libcMac.x86_64, libcImage.x86_64, libcLinuxGnu].some(facts => facts.byName.has(entry.name));
  entry.host = !known ? (ofTheSystem ? "not a function of the libc of the image" : "not a function of the system: bun or a library of the image") : !any ? "no request: the libc of the image does it" : missing.size ? "does not answer" : partial.size ? "answers in part" : "answers";
}

// ── K3: what shared source hands over that the two systems define differently ──

/** Families of constants that the host translates, by the request that carries them. */
const translated: { family: RegExp; where: string }[] = [
  { family: /^O_(RDONLY|WRONLY|RDWR|ACCMODE|CREAT|EXCL|NOCTTY|TRUNC|APPEND|NONBLOCK|CLOEXEC|DIRECTORY|NOFOLLOW|SYNC|DSYNC)$/, where: "open, openat, fcntl(F_SETFL, F_GETFL), pipe2, dup3" },
  { family: /^AT_(FDCWD|SYMLINK_NOFOLLOW|REMOVEDIR|EACCESS|SYMLINK_FOLLOW|EMPTY_PATH)$/, where: "the *at requests" },
  { family: /^E(?!CHO|XT[AB]$|XTPROC$|LAST$)[A-Z0-9]+$/, where: "the result of every request" },
  { family: /^S_IF[A-Z]+$|^S_I[RWX](USR|GRP|OTH)$|^S_IS(UID|GID|VTX)$|^S_IRWX[UGO]$/, where: "stat (the same numbers on both systems)" },
  { family: /^DT_[A-Z]+$/, where: "getdents64 (the same numbers on both systems)" },
  { family: /^CLOCK_(REALTIME|MONOTONIC|MONOTONIC_RAW|PROCESS_CPUTIME_ID|THREAD_CPUTIME_ID|BOOTTIME|REALTIME_COARSE|MONOTONIC_COARSE)$/, where: "clock_gettime, clock_getres, clock_nanosleep" },
  { family: /^SIG(HUP|INT|QUIT|ILL|TRAP|ABRT|BUS|FPE|KILL|USR1|SEGV|USR2|PIPE|ALRM|TERM|CHLD|CONT|STOP|TSTP|TTIN|TTOU|URG|XCPU|XFSZ|VTALRM|PROF|WINCH|IO|SYS)$/, where: "kill, tkill, rt_sigaction, rt_sigprocmask as arguments; not where bun keeps the number in data" },
  { family: /^SIG_(BLOCK|UNBLOCK|SETMASK)$|^SA_(ONSTACK|RESTART|NODEFER|RESETHAND|SIGINFO)$/, where: "rt_sigprocmask, rt_sigaction" },
  { family: /^(PROT_(READ|WRITE|EXEC|NONE)|MAP_(SHARED|PRIVATE|FIXED|ANON|ANONYMOUS|NORESERVE|FAILED)|MADV_(DONTNEED|NORMAL|RANDOM|SEQUENTIAL|WILLNEED))$/, where: "mmap, mprotect, madvise" },
  { family: /^F_(DUPFD|GETFD|SETFD|GETFL|SETFL|DUPFD_CLOEXEC|GETLK|SETLK|SETLKW|RDLCK|WRLCK|UNLCK)$|^FD_CLOEXEC$/, where: "fcntl" },
  { family: /^LOCK_(SH|EX|NB|UN)$/, where: "flock" },
  { family: /^(TIOCGWINSZ|FIONREAD|FIONBIO|FIOCLEX)$/, where: "ioctl" },
  { family: /^RLIMIT_(CPU|FSIZE|DATA|STACK|CORE|RSS|NPROC|NOFILE|MEMLOCK|AS)$|^RLIM_INFINITY$|^RUSAGE_(SELF|CHILDREN|THREAD)$/, where: "getrlimit, prlimit64, getrusage" },
  { family: /^POLL(IN|PRI|OUT|ERR|HUP|NVAL|RDNORM|RDBAND|WRNORM|WRBAND)$/, where: "poll, ppoll" },
  { family: /^UTIME_(NOW|OMIT)$/, where: "utimensat" },
  { family: /^(SEEK_(SET|CUR|END)|[RWXF]_OK|STD(IN|OUT|ERR)_FILENO|PATH_MAX)$/, where: "the same numbers on both systems" },
];
/** Structures that the host fills or reads field by field. */
const translatedTypes = new Set(["stat", "timespec", "timeval", "iovec", "rlimit", "rusage", "winsize", "statfs", "pollfd", "flock", "utsname", "sysinfo", "sigset_t", "stack_t", "dirent", "dirent64"]);

type K3 = { file: string; line?: number; in_function?: string; what: string; name: string; macos?: string; image?: string; why: string; found_by?: "reading" };
const k3: K3[] = [];
/** Whether the token is an argument of a call of a function of the libc: `libc::kill(pid, libc::SIGTERM)`. */
function isArgumentOfLibc(list: Token[], index: number): boolean {
  for (let i = index - 1, depth = 0; i >= 0 && index - i < 200; i--) {
    const t = list[i];
    if (t.kind === "close") depth++;
    else if (t.kind === "open") {
      if (depth > 0) depth--;
      else return t.text === "(" && list[i - 1]?.kind === "ident" && list[i - 2]?.text === "::" && (list[i - 3]?.text === "libc" || list[i - 3]?.text === "safe_libc");
    } else if (t.text === ";" && depth === 0) return false;
  }
  return false;
}
const fileOf = new Map(files.map(file => [file.path, file]));
for (const use of sharedUses) {
  const r = resolve_(use.name, use.called);
  const kind = r.image?.kind ?? r.macos?.kind;
  if (!kind || kind === "function") continue;
  const list = fileOf.get(use.file)!.list;
  const index = list.findIndex(t => t.line === use.line && t.text === use.name);
  const inFunction = index >= 0 ? enclosingFunction(list, index) : undefined;
  if (kind === "constant") {
    const rule = translated.find(entry => entry.family.test(use.name));
    if (!r.macos) {
      if (!rule) k3.push({ file: use.file, line: use.line, in_function: inFunction, what: "a constant that macOS does not have, in shared source", name: use.name, image: r.image?.value, why: "the source compiles for macOS today, so the place is most likely inside a cfg that this tool read as shared" });
      continue;
    }
    if (!r.differs) continue;
    // A signal number that is not handed to the libc is kept: the host never sees it.
    if (rule && /^SIG[A-Z0-9]+$/.test(use.name) && index >= 0 && !isArgumentOfLibc(list, index)) {
      k3.push({ file: use.file, line: use.line, in_function: inFunction, what: "a signal number kept in data", name: use.name, macos: r.macos.value, image: r.image?.value, why: "the host translates a signal number in a request (kill, rt_sigaction), not where bun keeps it or hands it on" });
      continue;
    }
    if (rule) continue;
    k3.push({ file: use.file, line: use.line, in_function: inFunction, what: "constant with another value", name: use.name, macos: r.macos.value, image: r.image?.value, why: "the host translates no request that carries it" });
  } else if (kind === "struct" || kind === "union") {
    if (!r.differs || translatedTypes.has(use.name)) continue;
    k3.push({ file: use.file, line: use.line, in_function: inFunction, what: `${kind} with another layout`, name: use.name, macos: r.macos?.value, image: r.image?.value, why: "the host does not convert it" });
  } else if (kind === "type_alias") {
    if (!r.differs) continue;
    k3.push({ file: use.file, line: use.line, in_function: inFunction, what: "type of another size or sign", name: use.name, macos: r.macos?.value, image: r.image?.value, why: "a value of this type in a structure or in data has the width of Linux in the image" });
  }
}
for (const decision of decisions) {
  k3.push({ file: decision.file, line: decision.line, in_function: decision.in_function, what: "decided when bun is compiled", name: decision.what, why: decision.in_image ? "the image is compiled for Linux: it decides for Linux on every host" : "not in the image" });
}
for (const entry of perOs.values()) {
  if (!entry.macos.length || !entry.linux.length) continue;
  k3.push({
    file: entry.file,
    line: entry.macos[0].line,
    what: "a table of bun's own with one definition for each OS",
    name: entry.item,
    macos: entry.macos[0].text.slice(0, 200),
    image: entry.linux[0].text.slice(0, 200),
    why: "the image has the definition for Linux; shared source that uses the name passes the value of Linux on every host",
  });
}

for (const known of JSON.parse(readFileSync(join(here, "macos-known.json"), "utf8")).k3 as { file: string; where: string; what: string; why: string }[]) {
  k3.push({ file: known.file, in_function: known.where, what: known.what, name: known.where, why: known.why, found_by: "reading" });
}

// ── the result ──

const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo, stdout: "pipe" }).stdout.toString().trim();
const k2 = places.filter(place => place.kind === "K2");
const k1List = [...k1.values()].sort((a, b) => a.name.localeCompare(b.name));
const result = {
  about: "Inventory of bun's code for macOS for the portable image. Written by misctools/portable/inventory/macos.ts; see the head of that file for what the kinds mean.",
  tree: commit,
  libc_crate: libcMac.aarch64.version,
  libc_of_the_image: musl.x86_64 ? "musl 1.2.5 with misctools/portable/libc/patch_musl.py" : "not found under WORK: the requests of the functions are not known",
  host: relative(repo, hostSource),
  crates: crates.map(crate => ({ name: crate.name, dir: crate.dir, files: files.filter(file => file.crate === crate.name).length })),
  counts: {
    places_for_macos_only: k2.length,
    of_them_with_a_function_of_the_system: k2.filter(place => place.functions.length).length,
    of_them_compiled_into_the_image: k2.filter(place => place.active.image).length,
    places_for_linux_only: places.filter(place => place.kind === "linux-only").length,
    functions_of_shared_source: k1List.length,
    of_them_not_answered_by_the_host: k1List.filter(entry => entry.host === "does not answer").length,
    k3: k3.length,
  },
  k1: {
    functions: k1List,
    not_answered_by_the_host: k1List.filter(entry => entry.host === "does not answer").map(entry => ({ name: entry.name, requests: entry.not_answered, uses: entry.uses })),
    answered_in_part: k1List.filter(entry => entry.host === "answers in part").map(entry => ({ name: entry.name, notes: entry.notes })),
    answered_by_the_libc_of_the_image_in_the_way_of_linux: k1List
      .map(entry => ({ entry, rule: answeredTheWayOfLinux.find(rule => rule.names.test(entry.name)) }))
      .filter(found => found.rule)
      .map(found => ({ name: found.entry.name, uses: found.entry.uses, used_in: found.entry.used_in, why: found.rule!.why })),
    requests_the_host_answers_on_macos: [...answers.values()].filter(answer => answer.macos).map(answer => answer.request + (answer.note ? ` (${answer.note})` : "")),
    requests_the_host_refuses: [...answers.values()].filter(answer => answer.refused).map(answer => answer.request),
  },
  k2: {
    functions: [...new Set(k2.flatMap(place => place.functions.map(f => f.symbol ?? f.name)))].sort(),
    variadic_functions: [...new Set(k2.flatMap(place => place.functions.filter(f => f.variadic).map(f => f.symbol ?? f.name)))].sort(),
    types: [...new Set(k2.flatMap(place => place.types.map(t => t.name)))].sort(),
    constants: [...new Set(k2.flatMap(place => place.constants.map(c => c.name)))].sort(),
    places: k2,
  },
  k3,
  linux_only: places.filter(place => place.kind === "linux-only"),
};
writeFileSync(outPath, JSON.stringify(result, null, 1) + "\n");
console.log(`${relative(process.cwd(), outPath)}: ${JSON.stringify(result.counts)}`);
if (args.includes("--summary")) {
  const byCrate = (list: { crate: string }[]) => crates.map(crate => `${crate.name} ${list.filter(item => item.crate === crate.name).length}`).join(", ");
  console.log(`K2 places by crate: ${byCrate(k2)}`);
  console.log(`K2 functions (${result.k2.functions.length}): ${result.k2.functions.join(" ")}`);
  console.log(`K2 variadic: ${result.k2.variadic_functions.join(" ")}`);
  console.log(`K1 not answered (${result.k1.not_answered_by_the_host.length}): ${result.k1.not_answered_by_the_host.map(entry => `${entry.name}[${entry.requests.join(",")}]`).join(" ")}`);
  console.log(`K1 not functions of the libc of the image: ${k1List.filter(entry => entry.host === "not a function of the libc of the image").map(entry => entry.name).join(" ")}`);
  console.log(`K1 answered in part: ${result.k1.answered_in_part.map(entry => entry.name).join(" ")}`);
  console.log(`K1 answered by the libc of the image in the way of Linux: ${result.k1.answered_by_the_libc_of_the_image_in_the_way_of_linux.map(entry => entry.name).join(" ")}`);
  const kinds = new Map<string, number>();
  for (const entry of k3) kinds.set(entry.what, (kinds.get(entry.what) ?? 0) + 1);
  console.log(`K3 by what: ${[...kinds].map(([what, count]) => `${what}: ${count}`).join("; ")}`);
}
