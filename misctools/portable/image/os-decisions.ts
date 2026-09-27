// Inventory of the decisions that bun's source takes by operating system, for the portable image.
//
//   bun misctools/portable/image/os-decisions.ts <out.json> [<out.txt>] [--root=<repository>]
//
// The portable image is compiled for Linux and runs on Linux, macOS and Windows. A decision that the compiler
// takes by the target OS is taken for Linux in the image. This tool finds those decisions and sorts them:
//
//   A  right in the image as it is: a detail of the Linux ABI the image is compiled for, or the host answers it
//   B  behaviour that JavaScript can see and that has to follow the host OS when the program runs
//   C  needs a native path through the host (spawn, event loop, console, file system semantics, sockets)
//   D  does not apply to the image (native addons, tinycc, formats of the crash handler, ...)
//   R  already decided when the program runs (bun_core::host and the patterns of bun_core::host_dispatch that
//      pick by it, Bun::hostOS(), process.platform of a built-in)
//
// What counts as a decision:
//   Rust   #[cfg(..)], #![cfg(..)], #[cfg_attr(.., ..)], cfg!(..) whose predicate names windows, unix, target_os,
//          target_family, target_vendor or target_env; and uses of the constants that are derived from them
//          (env::IS_WINDOWS, env::OS, SEP, SEP_STR, DELIMITER, platform::Auto, Platform::AUTO, ...)
//   C/C++  #if, #ifdef, #ifndef, #elif whose condition names OS(..), _WIN32, __APPLE__, __linux__, ...
//          (one decision per directive: an #else belongs to its #if)
//   JS     process.platform in src/js
//
// What is read is what the image compiles. A build for one OS has the tokens of bun's main, and where the
// image has other tokens the source has both: cfg_select! { bun_portable => .., _ => .. }, an item under
// #[cfg(not(bun_portable))], the #else of #if defined(BUN_PORTABLE). What the image does not compile of
// them is not a decision of the image; the report says how many there are (not_of_the_image).
//
// The class of a decision comes from the first rule of os-decisions.rules.ts that matches its file, its
// predicate and the code it guards. Every decision names its rule, so that a wrong class is a wrong rule.
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { rules, type Class, type Rule } from "./os-decisions.rules.ts";

export type Kind = "rust-cfg" | "rust-const" | "c-preprocessor" | "js-platform" | "runtime-host";

export interface Decision {
  file: string;
  line: number;
  kind: Kind;
  /** The predicate or the expression, white space collapsed. */
  text: string;
  /** The first line of code that follows the decision (what it guards), or the line of the expression. */
  context: string;
  /** The first lines of code that follow the decision: what the rules read, not part of the inventory. */
  scope: string;
}

export interface Classified extends Omit<Decision, "scope"> {
  class: Class;
  rule: string;
  why: string;
}

const roots = ["src", "packages/bun-usockets", "packages/bun-uws"];
const rustExtensions = new Set([".rs"]);
const cExtensions = new Set([".c", ".cc", ".cpp", ".h", ".hpp", ".m", ".mm"]);
const jsExtensions = new Set([".ts", ".js", ".tsx", ".mjs", ".cjs"]);

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".git") continue;
    const path = join(dir, name);
    // A symbolic link (src/cli is one) names files that are found at their own place.
    const stat = lstatSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (stat.isFile()) yield path;
  }
}

function collapse(text: string, limit = 240): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > limit ? one.slice(0, limit - 3) + "..." : one;
}

/** Line number (1-based) of every offset, by binary search over the offsets of the line starts. */
function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return offset => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/**
 * The source with comments, string literals and character literals replaced by spaces (line breaks stay), so
 * that offsets and line numbers are those of the file. `language` decides the literal syntax.
 */
export function blankCommentsAndStrings(source: string, language: "rust" | "js"): string {
  const out = source.split("");
  const n = source.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = source[i]!;
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      let j = source.indexOf("\n", i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
    } else if (c === "/" && d === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (source[j] === "/" && source[j + 1] === "*" && language === "rust") {
          depth++;
          j += 2;
        } else if (source[j] === "*" && source[j + 1] === "/") {
          depth--;
          j += 2;
        } else j++;
      }
      blank(i, j);
      i = j;
    } else if (
      language === "rust" &&
      c === "r" &&
      (d === '"' || d === "#") &&
      !/[A-Za-z0-9_]/.test(source[i - 1] ?? " ")
    ) {
      let hashes = 0;
      let j = i + 1;
      while (source[j] === "#") {
        hashes++;
        j++;
      }
      if (source[j] !== '"') {
        i++;
        continue;
      }
      const close = '"' + "#".repeat(hashes);
      let end = source.indexOf(close, j + 1);
      end = end < 0 ? n : end + close.length;
      blank(i, end);
      i = end;
    } else if (c === '"' || (language === "js" && (c === "'" || c === "`"))) {
      let j = i + 1;
      while (j < n && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else if (language === "rust" && c === "'") {
      // 'x' and '\n' are characters; 'a in `&'a T` is a lifetime.
      if (d === "\\") {
        const end = source.indexOf("'", i + 3);
        const stop = end < 0 ? n : end + 1;
        blank(i, stop);
        i = stop;
      } else if (source[i + 2] === "'") {
        blank(i, i + 3);
        i += 3;
      } else i++;
    } else i++;
  }
  return out.join("");
}

/** The text between the parenthesis at `open` and its partner, and the offset after the partner. */
function balanced(text: string, open: number): { inner: string; end: number } | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return undefined;
}

/** The first argument of a macro or attribute: up to the first comma that is not inside parentheses. */
function firstArgument(inner: string): string {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return inner.slice(0, i);
  }
  return inner;
}

const rustOsPredicate = /\b(windows|unix|target_os|target_family|target_vendor|target_env)\b/;
const rustConstants =
  /\b(?:env|Environment)::(IS_WINDOWS|IS_MAC|IS_LINUX|IS_POSIX|IS_FREEBSD|IS_KQUEUE|IS_ANDROID|IS_MUSL|OS|OS_NAME_NPM)\b|\bplatform::Auto\b|\bPlatform::AUTO\b|\b(?:SEP|SEP_STR|DELIMITER|NODE_MODULES_NEEDLE)\b/g;
const rustRuntimeHost =
  /\bhost::(?:native::)?(os|is_windows|is_mac|is_linux)\s*\(\)|\bplatform::Host\b|\bPlatform::host\s*\(\)|\bhost_(select|dispatch|const)!|\bhost_os\s*\((?=\s*(windows|posix|linux|macos)\b)/g;

function scopeAfter(lines: string[], line: number, count = 8): string {
  return collapse(lines.slice(line, line + count).join(" "), 800);
}

function contextAfter(lines: string[], line: number): string {
  // The code that an attribute guards: the next line that is not blank and not another attribute.
  for (let k = line; k < lines.length && k < line + 12; k++) {
    const text = lines[k]!.trim();
    if (text === "" || text.startsWith("#[") || text.startsWith("#![") || text.startsWith("//")) continue;
    return collapse(text, 160);
  }
  return "";
}

/** The index of the bracket that closes the one at `open`, in code without comments and strings. */
function closing(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return code.length - 1;
}

/** A predicate of `cfg` in the portable image: true, false, or undefined when it asks for more. */
function inTheImage(predicate: string): boolean | undefined {
  const text = predicate.replace(/\s+/g, "");
  const list = /^(not|any|all)\((.*)\)$/.exec(text);
  if (list !== null) {
    const parts: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < list[2]!.length; i++) {
      const c = list[2]![i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        parts.push(list[2]!.slice(from, i));
        from = i + 1;
      }
    }
    if (from < list[2]!.length) parts.push(list[2]!.slice(from));
    const values = parts.map(inTheImage);
    if (list[1] === "not") return values.length === 1 && values[0] !== undefined ? !values[0] : undefined;
    const decides = list[1] === "any";
    if (values.some(value => value === decides)) return decides;
    return values.every(value => value === !decides) ? !decides : undefined;
  }
  return text === "bun_portable" ? true : undefined;
}

/**
 * Code (comments and strings are blank already) without what the portable image does not compile of the
 * places that have the tokens of two builds: blank, so that offsets and lines stay.
 */
export function whatTheImageCompiles(code: string): string {
  const out = code.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const skipSpace = (at: number) => {
    while (at < code.length && /\s/.test(code[at]!)) at++;
    return at;
  };
  // cfg_select! { predicate => { .. } predicate => .., }: the first arm that holds stays.
  const select = /\bcfg_select\s*!\s*\{/g;
  for (let m = select.exec(code); m !== null; m = select.exec(code)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    const arms: { value: boolean | undefined; from: number; to: number }[] = [];
    let at = skipSpace(open + 1);
    while (at < close) {
      const arrow = code.indexOf("=>", at);
      if (arrow < 0 || arrow > close) break;
      const predicate = code.slice(at, arrow).trim();
      let from = skipSpace(arrow + 2);
      let to: number;
      if (code[from] === "{") {
        to = closing(code, from) + 1;
        from++;
        arms.push({ value: predicate === "_" ? true : inTheImage(predicate), from, to: to - 1 });
      } else {
        to = from;
        for (let depth = 0; to < close; to++) {
          const c = code[to];
          if (c === "(" || c === "[" || c === "{") depth++;
          else if (c === ")" || c === "]" || c === "}") depth--;
          else if (c === "," && depth === 0) break;
        }
        arms.push({ value: predicate === "_" ? true : inTheImage(predicate), from, to });
      }
      at = skipSpace(to);
      if (code[at] === ",") at = skipSpace(at + 1);
    }
    const chosen = arms.findIndex(arm => arm.value !== false);
    if (chosen < 0 || arms[chosen]!.value === undefined) continue;
    arms.forEach((arm, index) => {
      if (index !== chosen) blank(arm.from, arm.to);
    });
  }
  // #[cfg(predicate)] that the image does not meet: the attribute and what it stands in front of.
  const attribute = /#\s*\[\s*cfg\s*\(/g;
  for (let m = attribute.exec(code); m !== null; m = attribute.exec(code)) {
    const open = m.index + m[0].length - 1;
    const end = closing(code, open);
    if (inTheImage(code.slice(open + 1, end)) !== false) continue;
    let at = skipSpace(code.indexOf("]", end) + 1);
    // More attributes, and `pub`, `pub(crate)`.
    for (;;) {
      if (code[at] === "#" && code[skipSpace(at + 1)] === "[") at = skipSpace(closing(code, skipSpace(at + 1)) + 1);
      else if (/^pub\b/.test(code.slice(at, at + 4))) {
        at = skipSpace(at + 3);
        if (code[at] === "(") at = skipSpace(closing(code, at) + 1);
      } else break;
    }
    const word = /^[A-Za-z_]+/.exec(code.slice(at, at + 16))?.[0] ?? "";
    const toSemicolon = ["let", "const", "static", "use", "type"].includes(word);
    const item = [
      "fn",
      "impl",
      "struct",
      "enum",
      "union",
      "trait",
      "mod",
      "extern",
      "unsafe",
      "async",
      "macro_rules",
    ].includes(word);
    let to = at;
    for (; to < code.length; to++) {
      const c = code[to];
      if (c === "(" || c === "[") to = closing(code, to);
      else if (c === "{") {
        to = closing(code, to);
        if (toSemicolon) continue;
        const next = skipSpace(to + 1);
        // `if .. {} else {}`, `{ .. }.method()`: the expression goes on.
        if (!item && (/^else\b/.test(code.slice(next, next + 5)) || code[next] === "." || code[next] === "?")) continue;
        to++;
        if (code[skipSpace(to)] === ";" || (!item && code[skipSpace(to)] === ",")) to = skipSpace(to) + 1;
        break;
      } else if (c === ";" || (c === "," && !item && !toSemicolon)) {
        to++;
        break;
      } else if (c === ")" || c === "]" || c === "}") break;
    }
    blank(m.index, to);
  }
  return out.join("");
}

/** For each line of C or C++: does the portable image (BUN_PORTABLE is defined) read it. */
export function linesOfTheImage(lines: string[]): boolean[] {
  // For each open conditional: is it one of BUN_PORTABLE, and is its branch read.
  const open: { ours: boolean; read: boolean; wasRead: boolean }[] = [];
  return lines.map(line => {
    const directive = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)$/.exec(line);
    const reading = open.every(level => level.read);
    if (directive === null) return reading;
    const condition = directive[2]!
      .replace(/\/\/.*$/, "")
      .replace(/\/\*.*?\*\//g, "")
      .replace(/\s+/g, "");
    const word = directive[1]!;
    if (word === "if" || word === "ifdef" || word === "ifndef") {
      let value: boolean | undefined;
      if (/^\(?defined\(?BUN_PORTABLE\)?\)?$/.test(condition)) value = word !== "ifndef";
      else if (/^!\(?defined\(?BUN_PORTABLE\)?\)?$/.test(condition)) value = false;
      else if (condition === "BUN_PORTABLE") value = word === "ifdef";
      open.push(
        value === undefined ? { ours: false, read: true, wasRead: true } : { ours: true, read: value, wasRead: value },
      );
      return reading && value === undefined;
    }
    const level = open[open.length - 1];
    if (level === undefined) return reading;
    if (word === "endif") {
      open.pop();
      return !level.ours && open.every(l => l.read);
    }
    if (!level.ours) return reading;
    // #else and #elif of a condition with BUN_PORTABLE: what follows is read when nothing in front was.
    level.read = !level.wasRead;
    if (word === "elif") {
      // What follows is a conditional of its own, which the image reads or not as a whole.
      level.ours = false;
      return false;
    }
    level.wasRead = true;
    return false;
  });
}

export function scanRust(file: string, source: string, all = false): Decision[] {
  const blanked = blankCommentsAndStrings(source, "rust");
  const code = all ? blanked : whatTheImageCompiles(blanked);
  const lineOf = lineIndex(source);
  const lines = source.split("\n");
  const found: Decision[] = [];
  const cfg = /\b(cfg_attr|cfg)\s*(!?)\s*\(/g;
  for (let m = cfg.exec(code); m !== null; m = cfg.exec(code)) {
    const open = m.index + m[0].length - 1;
    const group = balanced(code, open);
    if (group === undefined) continue;
    // The predicate is read from the source: a string such as "linux" is blank in `code`.
    const inner = source.slice(open + 1, group.end - 1);
    const predicate = m[1] === "cfg_attr" ? firstArgument(inner) : inner;
    if (!rustOsPredicate.test(predicate)) continue;
    const line = lineOf(m.index);
    const isAttribute = m[2] === "" && /#!?\[\s*$/.test(code.slice(Math.max(0, m.index - 8), m.index));
    found.push({
      file,
      line,
      kind: "rust-cfg",
      text: collapse(`${m[1]}${m[2]}(${predicate})`),
      context: isAttribute ? contextAfter(lines, lineOf(group.end)) : collapse(lines[line - 1]!, 160),
      scope: scopeAfter(lines, isAttribute ? lineOf(group.end) : line - 1),
    });
  }
  for (const [pattern, kind] of [
    [rustConstants, "rust-const"],
    [rustRuntimeHost, "runtime-host"],
  ] as const) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(code); m !== null; m = pattern.exec(code)) {
      const line = lineOf(m.index);
      const text = lines[line - 1]!;
      // The definition of a constant is not a use of it.
      if (/^\s*pub(\([a-z]+\))?\s+(const|use|type|static)\b/.test(text) && kind === "rust-const") {
        if (!/=.*\b(SEP|SEP_STR|IS_WINDOWS|IS_MAC|IS_LINUX|IS_POSIX|OS)\b/.test(text.replace(/^[^=]*=/, "="))) continue;
      }
      found.push({
        file,
        line,
        kind,
        text: collapse(m[0]),
        context: collapse(text, 160),
        scope: scopeAfter(lines, line - 1, 3),
      });
    }
  }
  return found;
}

const cOsCondition =
  /\bOS\s*\(|\bPLATFORM\s*\(|\b_WIN32\b|\b_WIN64\b|\bWIN32\b|\b_MSC_VER\b|\b__CYGWIN__\b|\b__APPLE__\b|\b__MACH__\b|\b__linux__\b|\b__linux\b|\b__gnu_linux__\b|\b__FreeBSD__\b|\b__OpenBSD__\b|\b__NetBSD__\b|\b__ANDROID__\b|\b__unix__\b|\b__sun\b|\b__GLIBC__\b|\bLIBUS_USE_(EPOLL|KQUEUE|LIBUV|IO_URING)\b|\bBUN_HOST_MAY_BE_(WINDOWS|POSIX)\b/;
const cRuntimeHost =
  /\bBun::(hostOS|hostIsWindows|hostIsMac|hostIsLinux|hostPlatformName)\s*\(|\b(hostIsWindows|hostIsMac|hostIsLinux)\s*\(\)/g;

export function scanC(file: string, source: string, all = false): Decision[] {
  const lines = source.split("\n");
  const read = linesOfTheImage(lines);
  const found: Decision[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!all && !read[i]) continue;
    const directive = /^\s*#\s*(if|ifdef|ifndef|elif|elifdef|elifndef)\b(.*)$/.exec(lines[i]!);
    if (directive !== null) {
      let condition = directive[2]!;
      let last = i;
      while (condition.endsWith("\\") && last + 1 < lines.length) {
        last++;
        condition = condition.slice(0, -1) + " " + lines[last]!;
      }
      condition = condition.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (cOsCondition.test(condition)) {
        let context = "";
        for (let k = last + 1; k < lines.length && k < last + 12; k++) {
          const text = lines[k]!.trim();
          if (text === "" || text.startsWith("//")) continue;
          context = collapse(text, 160);
          break;
        }
        found.push({
          file,
          line: i + 1,
          kind: "c-preprocessor",
          text: collapse(`#${directive[1]} ${condition}`),
          context,
          scope: scopeAfter(lines, last + 1),
        });
      }
      continue;
    }
    cRuntimeHost.lastIndex = 0;
    const m = cRuntimeHost.exec(lines[i]!);
    if (m !== null && !/^\s*(\/\/|\*|BUN_HOST_OS_FUNCTION|ALWAYS_INLINE|constexpr)/.test(lines[i]!)) {
      found.push({
        file,
        line: i + 1,
        kind: "runtime-host",
        text: collapse(m[0]),
        context: collapse(lines[i]!, 160),
        scope: collapse(lines[i]!, 160),
      });
    }
  }
  return found;
}

export function scanJs(file: string, source: string, platformIsRuntime: boolean): Decision[] {
  const code = blankCommentsAndStrings(source, "js");
  const lineOf = lineIndex(source);
  const lines = source.split("\n");
  const found: Decision[] = [];
  const platform = /\bprocess\.platform\b/g;
  for (let m = platform.exec(code); m !== null; m = platform.exec(code)) {
    const line = lineOf(m.index);
    found.push({
      file,
      line,
      kind: platformIsRuntime ? "runtime-host" : "js-platform",
      text: "process.platform",
      context: collapse(lines[line - 1]!, 160),
      scope: collapse(lines[line - 1]!, 160),
    });
  }
  return found;
}

/** `all`: also what only a build that is not the image compiles. */
export function scanTree(root: string, all = false): Decision[] {
  // With TARGET_PLATFORM_AT_RUNTIME the built-in modules read process.platform when they run.
  const replacements = readFileSync(join(root, "src/codegen/replacements.ts"), "utf8");
  const platformIsRuntime = replacements.includes("TARGET_PLATFORM_AT_RUNTIME");
  const found: Decision[] = [];
  for (const top of roots) {
    for (const path of walk(join(root, top))) {
      const file = relative(root, path);
      const extension = extensionOf(file);
      if (rustExtensions.has(extension)) found.push(...scanRust(file, readFileSync(path, "utf8"), all));
      else if (cExtensions.has(extension)) found.push(...scanC(file, readFileSync(path, "utf8"), all));
      else if (jsExtensions.has(extension) && file.startsWith("src/js/"))
        found.push(...scanJs(file, readFileSync(path, "utf8"), platformIsRuntime));
    }
  }
  return found;
}

function matches(rule: Rule, decision: Decision): boolean {
  if (rule.kind !== undefined && !rule.kind.includes(decision.kind)) return false;
  if (rule.file !== undefined && !rule.file.test(decision.file)) return false;
  if (rule.text !== undefined && !rule.text.test(decision.text)) return false;
  if (rule.context !== undefined && !rule.context.test(decision.context)) return false;
  if (rule.scope !== undefined && !rule.scope.test(decision.scope)) return false;
  return true;
}

export function classify(decisions: Decision[]): Classified[] {
  return decisions.map(decision => {
    const rule = rules.find(r => matches(r, decision));
    const { scope: _scope, ...item } = decision;
    if (rule === undefined) return { ...item, class: "U" as Class, rule: "none", why: "no rule matches" };
    return { ...item, class: rule.class, rule: rule.id, why: rule.why };
  });
}

/** `src/<directory>` or `packages/<package>`; a file directly in `src` counts as `src`. */
export function directoryOf(file: string): string {
  const parts = file.split("/");
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootArgument = args.find(a => a.startsWith("--root="));
  const root = resolve(rootArgument?.slice("--root=".length) ?? join(import.meta.dir, "../../.."));
  const [outJson, outText] = args.filter(a => !a.startsWith("--"));
  if (outJson === undefined) {
    console.error("usage: bun os-decisions.ts <out.json> [<out.txt>] [--root=<repository>]");
    process.exit(2);
  }
  const classified = classify(scanTree(root));
  const notOfTheImage = scanTree(root, true).length - classified.length;
  classified.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

  const classes: Class[] = ["A", "B", "C", "D", "R", "U"];
  const zero = () => Object.fromEntries(classes.map(c => [c, 0])) as Record<Class, number>;
  const totalsByClass = zero();
  const totalsByKind: Record<string, Record<Class, number>> = {};
  const totalsByDirectory: Record<string, Record<Class, number> & { total: number }> = {};
  const rulesUsed: Record<string, number> = {};
  for (const item of classified) {
    totalsByClass[item.class]++;
    (totalsByKind[item.kind] ??= zero())[item.class]++;
    const directory = (totalsByDirectory[directoryOf(item.file)] ??= { ...zero(), total: 0 });
    directory[item.class]++;
    directory.total++;
    rulesUsed[item.rule] = (rulesUsed[item.rule] ?? 0) + 1;
  }
  const list = (c: Class) =>
    classified
      .filter(item => item.class === c)
      .map(({ file, line, kind, text, context, rule, why }) => ({ file, line, kind, text, context, rule, why }));
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim();
  const dirty =
    Bun.spawnSync(["git", "status", "--porcelain", "--", ...roots], { cwd: root })
      .stdout.toString()
      .trim() !== "";
  const report = {
    tool: "misctools/portable/image/os-decisions.ts",
    commit: head,
    uncommitted_changes_in_the_scanned_directories: dirty,
    scanned: roots,
    classes: {
      A: "right in the image as it is (a detail of the Linux ABI of the image, or the host answers it)",
      B: "JavaScript can see it: has to follow the host OS when the program runs",
      C: "needs a native path through the host (spawn, event loop, console, file system semantics, sockets)",
      D: "does not apply to the image",
      R: "decided when the program runs (converted)",
      U: "no rule matches",
    },
    total: classified.length,
    not_of_the_image: notOfTheImage,
    totals_by_class: totalsByClass,
    totals_by_kind: totalsByKind,
    totals_by_directory: Object.fromEntries(Object.entries(totalsByDirectory).sort(([a], [b]) => (a < b ? -1 : 1))),
    rules: rules.map(r => ({ id: r.id, class: r.class, why: r.why, decisions: rulesUsed[r.id] ?? 0 })),
    B: list("B"),
    C: list("C"),
    R: list("R"),
    U: list("U"),
    A_and_D: classified
      .filter(item => item.class === "A" || item.class === "D")
      .map(({ file, line, kind, text, class: c, rule }) => ({ file, line, kind, text, class: c, rule })),
  };
  writeFileSync(outJson, JSON.stringify(report, null, 1) + "\n");

  const rows: string[] = [];
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const num = (s: string | number, n: number) => String(s).padStart(n);
  rows.push(`OS decisions at compile time, commit ${head}${dirty ? " + uncommitted changes" : ""}`);
  rows.push("");
  rows.push(`${pad("directory", 34)}${classes.map(c => num(c, 7)).join("")}${num("total", 8)}`);
  for (const [directory, t] of Object.entries(report.totals_by_directory)) {
    rows.push(`${pad(directory, 34)}${classes.map(c => num(t[c] === 0 ? "." : t[c], 7)).join("")}${num(t.total, 8)}`);
  }
  rows.push(`${pad("TOTAL", 34)}${classes.map(c => num(totalsByClass[c], 7)).join("")}${num(classified.length, 8)}`);
  rows.push(`not counted: ${notOfTheImage} decisions in what only a build that is not the portable image compiles`);
  rows.push("");
  rows.push(`${pad("kind", 34)}${classes.map(c => num(c, 7)).join("")}`);
  for (const [kind, t] of Object.entries(totalsByKind)) {
    rows.push(`${pad(kind, 34)}${classes.map(c => num(t[c] === 0 ? "." : t[c], 7)).join("")}`);
  }
  rows.push("");
  rows.push(`${pad("rule", 44)}${pad("class", 6)}${num("count", 6)}  why`);
  for (const r of report.rules) {
    if (r.decisions === 0) continue;
    rows.push(`${pad(r.id, 44)}${pad(r.class, 6)}${num(r.decisions, 6)}  ${r.why}`);
  }
  if (outText !== undefined) writeFileSync(outText, rows.join("\n") + "\n");
  console.log(rows.slice(0, 3 + Object.keys(report.totals_by_directory).length + 2).join("\n"));
}
