// Reads Rust sources the way the inventory needs them: the tokens of a file, the `cfg` predicates in it,
// what each predicate covers, and whether it holds for a target.
//
// This is no parser of Rust. It knows the tokens, the three kinds of brackets and the shapes of the items
// that a `cfg` attribute stands in front of in bun's sources. A predicate it cannot evaluate for a target
// (a feature, `debug_assertions`, `test`) is a free name: the callers ask with every value of it.

export type Token = {
  kind: "ident" | "punct" | "literal" | "lifetime" | "open" | "close";
  text: string;
  line: number;
  /** Where the token starts in the source, and where it ends. */
  offset: number;
  end: number;
  /** The index of the token that closes this one, or opens it. */
  partner?: number;
};

export function tokens(source: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  let i = 0;
  const n = source.length;
  const isIdentStart = (c: string) => /[A-Za-z_]/.test(c) || c > "\x7f";
  const isIdent = (c: string) => /[A-Za-z_0-9]/.test(c) || c > "\x7f";
  const count = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (source.charCodeAt(k) === 10) line++;
  };
  const stack: number[] = [];
  while (i < n) {
    const c = source[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      let depth = 1;
      const start = i;
      i += 2;
      while (i < n && depth > 0) {
        if (source[i] === "/" && source[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (source[i] === "*" && source[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      count(start, i);
      continue;
    }
    // Raw strings: r"..", r#".."#, br#".."#, cr#".."#
    const raw = /^(?:b|c)?r(#*)"/.exec(source.slice(i, i + 40));
    if (raw && (i === 0 || !isIdent(source[i - 1]))) {
      const end = source.indexOf('"' + raw[1], i + raw[0].length);
      const stop = end < 0 ? n : end + 1 + raw[1].length;
      out.push({ kind: "literal", text: source.slice(i, stop), line, offset: i, end: stop });
      count(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || ((c === "b" || c === "c") && source[i + 1] === '"')) {
      const start = i;
      i += c === '"' ? 1 : 2;
      while (i < n && source[i] !== '"') i += source[i] === "\\" ? 2 : 1;
      i++;
      out.push({ kind: "literal", text: source.slice(start, i), line, offset: start, end: i });
      count(start, i);
      continue;
    }
    if (c === "'" || (c === "b" && source[i + 1] === "'")) {
      const start = i;
      const at = c === "'" ? i + 1 : i + 2;
      // A character: 'x', '\n', '\u{1f35e}'. Otherwise a lifetime or a label.
      const character = /^(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^\\'])'/.exec(source.slice(at, at + 16));
      if (character) {
        i = at + character[0].length;
        out.push({ kind: "literal", text: source.slice(start, i), line, offset: start, end: i });
        continue;
      }
      i = at;
      while (i < n && isIdent(source[i])) i++;
      out.push({ kind: "lifetime", text: source.slice(start, i), line, offset: start, end: i });
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdent(source[i])) i++;
      // `r#name`
      if (source[i] === "#" && source.slice(start, i) === "r" && isIdentStart(source[i + 1] ?? "")) {
        i++;
        while (i < n && isIdent(source[i])) i++;
      }
      out.push({ kind: "ident", text: source.slice(start, i), line, offset: start, end: i });
      continue;
    }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9A-Za-z_.]/.test(source[i])) {
        // `0..4` and `1.max(2)`: the dot belongs to the number only in front of a digit.
        if (source[i] === "." && !/[0-9]/.test(source[i + 1] ?? "")) break;
        i++;
      }
      out.push({ kind: "literal", text: source.slice(start, i), line, offset: start, end: i });
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      stack.push(out.length);
      out.push({ kind: "open", text: c, line, offset: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      const open = stack.pop();
      const token: Token = { kind: "close", text: c, line, offset: i, end: i + 1, partner: open };
      if (open !== undefined) out[open].partner = out.length;
      out.push(token);
      i++;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === "::" || two === "->" || two === "=>" || two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||" || two === "..") {
      out.push({ kind: "punct", text: two, line, offset: i, end: i + 2 });
      i += 2;
      continue;
    }
    out.push({ kind: "punct", text: c, line, offset: i, end: i + 1 });
    i++;
  }
  return out;
}

// ── predicates ──

export type Predicate =
  | { op: "all" | "any"; of: Predicate[] }
  | { op: "not"; of: Predicate }
  | { op: "flag"; name: string }
  | { op: "is"; name: string; value: string }
  | { op: "true" }
  | { op: "false" };

export function parsePredicate(list: Token[]): Predicate {
  let at = 0;
  const parse = (): Predicate => {
    const token = list[at++];
    if (!token || token.kind !== "ident") throw new Error(`cfg: unexpected ${token?.text ?? "end"} at line ${token?.line}`);
    const next = list[at];
    if (next?.kind === "open" && next.text === "(") {
      at++;
      const of: Predicate[] = [];
      while (list[at] && list[at].kind !== "close") {
        of.push(parse());
        if (list[at]?.text === ",") at++;
      }
      at++;
      if (token.text === "not") return of.length === 1 ? { op: "not", of: of[0] } : { op: "false" };
      if (token.text === "all" || token.text === "any") return { op: token.text, of };
      throw new Error(`cfg: ${token.text}(..) at line ${token.line}`);
    }
    if (next?.text === "=") {
      const value = list[at + 1];
      at += 2;
      return { op: "is", name: token.text, value: JSON.parse(value.text) };
    }
    if (token.text === "true" || token.text === "false") return { op: token.text };
    return { op: "flag", name: token.text };
  };
  return parse();
}

export function show(p: Predicate): string {
  switch (p.op) {
    case "all":
    case "any":
      return `${p.op}(${p.of.map(show).join(", ")})`;
    case "not":
      return `not(${show(p.of)})`;
    case "flag":
      return p.name;
    case "is":
      return `${p.name} = "${p.value}"`;
    default:
      return p.op;
  }
}

export const and = (list: Predicate[]): Predicate => (list.length === 0 ? { op: "true" } : list.length === 1 ? list[0] : { op: "all", of: list });

/** What a compilation target sets. A name that is not here is free. */
export type Target = { name: string; flags: Set<string>; values: Record<string, string[]> };

const base = (os: string, family: string, arch: string, env: string, vendor: string, more: string[] = []): Omit<Target, "name"> => ({
  flags: new Set([family, ...more]),
  values: {
    target_os: [os],
    target_family: [family],
    target_arch: [arch],
    target_env: [env],
    target_vendor: [vendor],
    target_pointer_width: ["64"],
    target_endian: ["little"],
    target_has_atomic: ["8", "16", "32", "64", "ptr"],
    panic: ["abort"],
  },
});
export const targets: Record<string, Target> = {
  "linux-x86_64": { name: "x86_64-unknown-linux-gnu", ...base("linux", "unix", "x86_64", "gnu", "unknown") },
  "linux-aarch64": { name: "aarch64-unknown-linux-gnu", ...base("linux", "unix", "aarch64", "gnu", "unknown") },
  "macos-x86_64": { name: "x86_64-apple-darwin", ...base("macos", "unix", "x86_64", "", "apple") },
  "macos-aarch64": { name: "aarch64-apple-darwin", ...base("macos", "unix", "aarch64", "", "apple") },
  "windows-x86_64": { name: "x86_64-pc-windows-msvc", ...base("windows", "windows", "x86_64", "msvc", "pc") },
  "image-x86_64": { name: "x86_64-unknown-linux-musl, bun_portable", ...base("linux", "unix", "x86_64", "musl", "unknown", ["bun_portable", "rustix_use_libc"]) },
  "image-aarch64": { name: "aarch64-unknown-linux-musl, bun_portable", ...base("linux", "unix", "aarch64", "musl", "unknown", ["bun_portable", "rustix_use_libc"]) },
};
/** Names that a target decides, also when it does not set them. */
const decided = new Set(["unix", "windows", "bun_portable", "rustix_use_libc"]);
/** What a release build of bun has of the names that no target decides. */
const release: Record<string, boolean> = { debug_assertions: false, test: false, miri: false, bun_asan: false, bun_debug: false, doc: false, bun_codegen_embed: true, socket_fault_injection: false };

export function freeNames(p: Predicate, out = new Set<string>()): Set<string> {
  switch (p.op) {
    case "all":
    case "any":
      for (const q of p.of) freeNames(q, out);
      break;
    case "not":
      freeNames(p.of, out);
      break;
    case "flag":
      if (!decided.has(p.name)) out.add(p.name);
      break;
    case "is":
      if (p.name === "feature" || p.name === "target_feature") out.add(`${p.name}=${p.value}`);
      break;
  }
  return out;
}

export function holds(p: Predicate, target: Target, free: Record<string, boolean> = release): boolean {
  switch (p.op) {
    case "true":
      return true;
    case "false":
      return false;
    case "all":
      return p.of.every(q => holds(q, target, free));
    case "any":
      return p.of.some(q => holds(q, target, free));
    case "not":
      return !holds(p.of, target, free);
    case "flag":
      if (decided.has(p.name)) return target.flags.has(p.name);
      return free[p.name] ?? release[p.name] ?? false;
    case "is":
      if (p.name === "feature" || p.name === "target_feature") return free[`${p.name}=${p.value}`] ?? false;
      return (target.values[p.name] ?? []).includes(p.value);
  }
}

/** Whether the predicate can have different values for the two targets, with the same free names. */
export function differs(p: Predicate, a: Target, b: Target): boolean {
  const names = [...freeNames(p)].slice(0, 8);
  for (let bits = 0; bits < 1 << names.length; bits++) {
    const free: Record<string, boolean> = {};
    names.forEach((name, index) => (free[name] = !!(bits & (1 << index))));
    if (holds(p, a, free) !== holds(p, b, free)) return true;
  }
  return false;
}

// ── what a `cfg` covers ──

export type Site = {
  /** Index of the `#` of the first attribute of the item. */
  attributeStart: number;
  /** The first and the last token of what the predicate covers (attributes not counted). */
  start: number;
  end: number;
  line: number;
  endLine: number;
  predicate: Predicate;
  written: string;
  /** `fn name`, `mod name`, `const NAME`, `block`, `statement`, `field name`, `arm`, .. */
  item: string;
  /** The other attributes of the item, as text: `cfg_attr(bun_portable, bun_portable_macros::host_os(..))`. */
  attributes: string[];
  kind: "attribute" | "inner" | "cfg!" | "host_select" | "host_libc";
  /** An arm of `host_select!` or `host_only!`: whether the portable image has it, and for which hosts. */
  inImage?: "macos" | "windows" | "others" | "no";
};

/** The arms of bun_core::host_select! and host_only!: the `cfg` each stands for in a build for one OS,
    and the hosts that the portable image runs it on. */
const arms: Record<string, { cfg: string; inImage: NonNullable<Site["inImage"]> }> = {
  windows: { cfg: "windows", inImage: "windows" },
  posix: { cfg: "not(windows)", inImage: "others" },
  unix: { cfg: "unix", inImage: "others" },
  linux: { cfg: 'any(target_os = "linux", target_os = "android")', inImage: "others" },
  not_linux: { cfg: 'not(any(target_os = "linux", target_os = "android"))', inImage: "macos" },
  macos: { cfg: 'target_os = "macos"', inImage: "macos" },
  not_macos: { cfg: 'not(target_os = "macos")', inImage: "others" },
  freebsd: { cfg: 'target_os = "freebsd"', inImage: "no" },
  not_macos_not_linux: { cfg: 'not(any(target_os = "macos", target_os = "linux", target_os = "android"))', inImage: "no" },
  macos_freebsd: { cfg: 'any(target_os = "macos", target_os = "freebsd")', inImage: "macos" },
  not_macos_not_freebsd: { cfg: 'not(any(target_os = "macos", target_os = "freebsd"))', inImage: "others" },
};

const text = (list: Token[], from: number, to: number) => {
  let out = "";
  for (let i = from; i <= to && i < list.length; i++) {
    const t = list[i];
    const previous = list[i - 1];
    const tight = i === from || previous.kind === "open" || t.kind === "close" || t.text === "," || t.text === "::" || previous.text === "::" || t.text === "(" || previous.text === "!" || t.text === "!";
    out += (tight ? "" : " ") + t.text;
  }
  return out;
};

const qualifiers = new Set(["pub", "unsafe", "async", "default", "safe", "extern"]);

/** The last token of the item, statement, field or arm that starts at `start`. */
export function extent(list: Token[], start: number): { end: number; item: string } {
  let at = start;
  const limit = list.length;
  // Visibility and qualifiers.
  while (at < limit) {
    const t = list[at];
    if (t.kind === "ident" && qualifiers.has(t.text)) {
      at++;
      if (t.text === "pub" && list[at]?.text === "(") at = list[at].partner! + 1;
      if (t.text === "extern" && list[at]?.kind === "literal") at++;
      continue;
    }
    if (t.kind === "ident" && t.text === "const" && list[at + 1]?.kind === "ident" && ["fn", "unsafe", "extern", "async"].includes(list[at + 1].text)) {
      at++;
      continue;
    }
    break;
  }
  const first = list[at];
  if (!first) return { end: limit - 1, item: "end of file" };
  const name = () => (list[at + 1]?.kind === "ident" ? list[at + 1].text : "");
  /** The first `;` or the end of the first `{..}` that is not inside of brackets. */
  const toBodyOrSemicolon = (from: number) => {
    for (let i = from; i < limit; i++) {
      const t = list[i];
      if (t.kind === "open") {
        if (t.text === "{") return t.partner ?? limit - 1;
        i = t.partner ?? limit - 1;
        continue;
      }
      if (t.kind === "close") return i - 1;
      if (t.text === ";") return i;
    }
    return limit - 1;
  };
  const toSemicolon = (from: number) => {
    for (let i = from; i < limit; i++) {
      const t = list[i];
      if (t.kind === "open") {
        i = t.partner ?? limit - 1;
        continue;
      }
      if (t.kind === "close") return i - 1;
      if (t.text === ";") return i;
    }
    return limit - 1;
  };
  if (first.kind === "open" && first.text === "{") {
    // `unsafe {`, `{`
    return { end: first.partner ?? limit - 1, item: "block" };
  }
  if (first.kind === "ident") {
    switch (first.text) {
      case "fn":
        return { end: toBodyOrSemicolon(at), item: `fn ${name()}` };
      case "struct":
      case "union":
      case "enum":
      case "trait":
      case "mod": {
        let end = toBodyOrSemicolon(at);
        // `struct Name(..);`
        if (list[end]?.text !== ";" && list[end + 1]?.text === ";" && list[end]?.text !== "}") end++;
        return { end, item: `${first.text} ${name()}` };
      }
      case "impl": {
        const end = toBodyOrSemicolon(at);
        const open = list.findIndex((t, i) => i > at && t.kind === "open" && t.text === "{");
        return { end, item: `impl ${text(list, at + 1, Math.min(open - 1, at + 8))}` };
      }
      case "macro_rules":
        return { end: toBodyOrSemicolon(at), item: `macro_rules! ${list[at + 2]?.text ?? ""}` };
      case "const":
      case "static":
      case "type":
        return { end: toSemicolon(at), item: `${first.text} ${list[at + 1]?.text === "mut" ? list[at + 2]?.text : name()}` };
      case "use":
        return { end: toSemicolon(at), item: `use ${text(list, at + 1, Math.min(toSemicolon(at) - 1, at + 6))}` };
      case "let":
        return { end: toSemicolon(at), item: `let ${list[at + 1]?.text === "mut" ? list[at + 2]?.text : name()}` };
      case "if":
      case "match":
      case "while":
      case "for":
      case "loop": {
        let end = toBodyOrSemicolon(at);
        while (list[end + 1]?.text === "else") end = toBodyOrSemicolon(end + 2);
        if (list[end + 1]?.text === ";") end++;
        return { end, item: `${first.text} statement` };
      }
      case "return":
      case "break":
      case "continue":
        return { end: toSemicolon(at), item: `${first.text} statement` };
    }
  }
  // `unsafe extern "C" {` and `extern "C" {`: the qualifiers were skipped, the block is next.
  if (at > start && first.kind === "open") return { end: first.partner ?? limit - 1, item: list[start].text === "unsafe" && list[start + 1]?.text === "{" ? "block" : "extern block" };
  // A macro call that is an item: `name! { .. }`, `path::name!(..);`
  {
    let i = at;
    while (list[i]?.kind === "ident" && list[i + 1]?.text === "::") i += 2;
    if (list[i]?.kind === "ident" && list[i + 1]?.text === "!" && list[i + 2]?.kind === "open") {
      let end = list[i + 2].partner ?? limit - 1;
      if (list[end + 1]?.text === ";") end++;
      return { end, item: `${list[i].text}!` };
    }
  }
  // A field, a variant, an arm, an argument, an expression: up to the `,` or the `;` that is not inside
  // of brackets, or up to the bracket that closes what this is in.
  let angle = 0;
  let sawArrow = false;
  for (let i = at; i < limit; i++) {
    const t = list[i];
    if (t.kind === "open") {
      const close = t.partner ?? limit - 1;
      if (sawArrow && t.text === "{" && list[i - 1]?.text === "=>") {
        return { end: list[close + 1]?.text === "," ? close + 1 : close, item: "arm" };
      }
      i = close;
      continue;
    }
    if (t.kind === "close") return { end: i - 1, item: describe(list, at, i - 1, sawArrow) };
    if (t.text === "=>") sawArrow = true;
    if (t.text === "<" && (list[i - 1]?.kind === "ident" || list[i - 1]?.text === "::")) angle++;
    else if (t.text === ">" && angle > 0) angle--;
    else if ((t.text === "," && angle === 0) || t.text === ";") return { end: i, item: describe(list, at, i, sawArrow) };
  }
  return { end: limit - 1, item: "rest of the file" };
}

function describe(list: Token[], from: number, to: number, arm: boolean): string {
  if (arm) return "arm";
  if (list[from]?.kind === "ident" && list[from + 1]?.text === ":") return `field ${list[from].text}`;
  if (list[to]?.text === ";") return "statement";
  return "expression";
}

/** Every place of the file where a predicate decides what is compiled, or what a macro of bun picks. */
export function sites(list: Token[]): Site[] {
  const out: Site[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    // `cfg!(..)`
    if (t.kind === "ident" && t.text === "cfg" && list[i + 1]?.text === "!" && list[i + 2]?.text === "(") {
      const close = list[i + 2].partner!;
      try {
        const predicate = parsePredicate(list.slice(i + 3, close));
        out.push({ attributeStart: i, start: i, end: close, line: t.line, endLine: list[close].line, predicate, written: show(predicate), item: "cfg!", attributes: [], kind: "cfg!" });
      } catch {}
      i = close;
      continue;
    }
    // `host_select! { arm => { .. } .. }`, `host_only! { arm => { .. } }`, `host_libc!(..)`
    if (t.kind === "ident" && (t.text === "host_select" || t.text === "host_only" || t.text === "host_libc") && list[i + 1]?.text === "!" && list[i + 2]?.kind === "open" && list[i - 1]?.text !== "macro_rules") {
      const close = list[i + 2].partner!;
      if (t.text === "host_libc") {
        out.push({ attributeStart: i, start: i + 3, end: close - 1, line: t.line, endLine: list[close].line, predicate: { op: "true" }, written: "host_libc!", item: "expression", attributes: [], kind: "host_libc" });
        continue;
      }
      for (let k = i + 3; k < close; k++) {
        const name = list[k];
        if (name.kind !== "ident") continue;
        let at = k + 1;
        let written = arms[name.text]?.cfg;
        let inImage: Site["inImage"] = arms[name.text]?.inImage;
        if (name.text === "cfg" && list[at]?.text === "(") {
          written = show(parsePredicate(list.slice(at + 1, list[at].partner!)));
          inImage = "no";
          at = list[at].partner! + 1;
        }
        if (list[at]?.text !== "=>" || list[at + 1]?.text !== "{" || written === undefined) continue;
        const end = list[at + 1].partner!;
        const predicate = parsePredicate(tokens(written));
        out.push({ attributeStart: k, start: at + 1, end, line: name.line, endLine: list[end].line, predicate, written, item: "block", attributes: [`${t.text}!`], kind: "host_select", inImage });
        // The arms inside of the block are found when the loop gets there.
        k = at + 1;
      }
      continue;
    }
    if (t.text !== "#") continue;
    const inner = list[i + 1]?.text === "!";
    const open = list[i + (inner ? 2 : 1)];
    if (open?.kind !== "open" || open.text !== "[") continue;
    if (inner) {
      const close = open.partner!;
      const head = list[i + 3];
      if (head?.text === "cfg" && list[i + 4]?.text === "(") {
        const predicate = parsePredicate(list.slice(i + 5, list[i + 4].partner!));
        out.push({ attributeStart: i, start: 0, end: list.length - 1, line: t.line, endLine: list[list.length - 1]?.line ?? t.line, predicate, written: show(predicate), item: "file", attributes: [], kind: "inner" });
      }
      i = close;
      continue;
    }
    // The attributes of one item.
    const attributeStart = i;
    const predicates: Predicate[] = [];
    const attributes: string[] = [];
    let at = i;
    while (list[at]?.text === "#" && list[at + 1]?.kind === "open" && list[at + 1].text === "[") {
      const close = list[at + 1].partner!;
      const head = list[at + 2];
      if (head?.text === "cfg" && list[at + 3]?.text === "(") {
        try {
          predicates.push(parsePredicate(list.slice(at + 4, list[at + 3].partner!)));
        } catch {}
      } else attributes.push(text(list, at + 2, close - 1));
      at = close + 1;
    }
    if (predicates.length) {
      const found = extent(list, at);
      const predicate = and(predicates);
      out.push({
        attributeStart,
        start: at,
        end: found.end,
        line: list[attributeStart].line,
        endLine: list[found.end]?.line ?? list[attributeStart].line,
        predicate,
        written: show(predicate),
        item: found.item,
        attributes,
        kind: "attribute",
      });
    }
    i = at - 1;
  }
  return out;
}

/** `mod name;` declarations of a file, each with the predicates in front of it and its `#[path]`. */
export function moduleDeclarations(list: Token[], all: Site[]): { name: string; line: number; path?: string; conditionalPaths: { predicate: Predicate; path: string }[]; tokenIndex: number }[] {
  const out: ReturnType<typeof moduleDeclarations> = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind !== "ident" || list[i].text !== "mod" || list[i + 1]?.kind !== "ident" || list[i + 2]?.text !== ";") continue;
    // Attributes in front of it: walk back over `pub`, `pub(crate)` and attribute groups.
    let at = i - 1;
    while (at >= 0 && (list[at].text === "pub" || (list[at].kind === "close" && list[at].text === ")" && list[list[at].partner! - 1]?.text === "pub"))) at = list[at].text === "pub" ? at - 1 : list[at].partner! - 2;
    let path: string | undefined;
    const conditionalPaths: { predicate: Predicate; path: string }[] = [];
    while (at >= 0 && list[at].kind === "close" && list[at].text === "]" && list[list[at].partner! - 1]?.text === "#") {
      const open = list[at].partner!;
      const inside = list.slice(open + 1, at);
      if (inside[0]?.text === "path" && inside[1]?.text === "=") path = JSON.parse(inside[2].text);
      if (inside[0]?.text === "cfg_attr" && inside[1]?.text === "(") {
        const comma = inside.findIndex((t, k) => k > 1 && t.text === "," && depthAt(inside, k) === 1);
        const rest = inside.slice(comma + 1);
        if (comma > 0 && rest[0]?.text === "path" && rest[1]?.text === "=") {
          try {
            conditionalPaths.push({ predicate: parsePredicate(inside.slice(2, comma)), path: JSON.parse(rest[2].text) });
          } catch {}
        }
      }
      at = open - 2;
    }
    out.push({ name: list[i + 1].text, line: list[i].line, path, conditionalPaths, tokenIndex: i });
  }
  void all;
  return out;
}

function depthAt(list: Token[], index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    if (list[i].kind === "open") depth++;
    else if (list[i].kind === "close") depth--;
  }
  return depth;
}

/** The predicates of the sites that cover the token, outermost first. */
export function covering(all: Site[], index: number): Site[] {
  return all.filter(site => site.kind !== "cfg!" && index >= site.start && index <= site.end).sort((a, b) => a.start - b.start || b.end - a.end);
}

/** The name of the function that the token is in, if any. */
export function enclosingFunction(list: Token[], index: number): string | undefined {
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const t = list[i];
    if (t.kind === "close" && t.text === "}") {
      i = t.partner ?? i;
      continue;
    }
    if (t.kind === "open" && t.text === "{") {
      depth++;
      // What is in front of this `{`: look for `fn name` before the next `{`, `}` or `;`.
      for (let k = i - 1; k >= 0; k--) {
        const s = list[k];
        if (s.kind === "close" && (s.text === ")" || s.text === "]")) {
          k = s.partner ?? k;
          continue;
        }
        if (s.text === ";" || s.text === "{" || s.text === "}") break;
        if (s.kind === "ident" && s.text === "fn" && list[k + 1]?.kind === "ident") return list[k + 1].text;
      }
    }
  }
  void depth;
  return undefined;
}

export { text as tokenText };
