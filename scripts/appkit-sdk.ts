// What the generators that read the macOS SDK for bun:objc share:
// scripts/appkit-sdk-methods.ts (sdk.rs), scripts/appkit-enums.ts
// (appkit_enums.ts, cf.rs), both written into the build's codegen directory
// by the build, and scripts/appkit-dts.ts (packages/bun-types/objc-sdk.d.ts,
// committed).
// That is one translation unit (the umbrella headers of the frameworks the
// bridge loads) preprocessed and dumped by the SDK's clang, a reader that
// turns the dump into classes, protocols, methods, properties, structs and
// typedefs, the Objective-C type encoder clang applies to them (so a
// table can carry `v24@0:8@16` the way the compiler would have emitted it),
// and the first-line stamp with the `--check` handling every generated file
// gets. Nothing here asks the running system: the output is a function of
// the SDK and of the sources in this tree (the binding tables in
// src/appkit/objc and src/js/bun/appkit.ts). The committed typings read the
// SDK of the version the build pins (MACOS_SDK_VERSION in
// scripts/build/macos-sdk.ts), so they are the same on every machine that
// has that SDK; the build's tables read the SDK the build links
// ({@link useSdk}). The stamp names the version read.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MACOS_SDK_VERSION } from "./build/macos-sdk.ts";

export const root = join(import.meta.dir, "..");

/** The frameworks the bridge loads (src/appkit/objc/mod.rs). */
export const BRIDGED = ["Foundation", "AppKit", "QuartzCore", "Metal", "MetalKit"];

/** The headers the translation unit imports: the umbrella header of each bridged framework, and NSDebug.h for its constants. */
export const HEADERS = [...BRIDGED.map(f => `${f}/${f}.h`), "Foundation/NSDebug.h"];

// ──────────────────────────────── the SDK ───────────────────────────────────

/** The version of the macOS SDK the generated files are a function of: the one the build pins. */
const SDK_VERSION = MACOS_SDK_VERSION;

export type Toolchain =
  | { sdk: string; version: string }
  /** `found`: a macOS SDK this machine has that is not {@link SDK_VERSION}, when it has one at all. */
  | { sdk: null; version: null; reason: string; found: { path: string; version: string } | null };

let toolchain: Toolchain | undefined;

/** The `Version` an SDK's SDKSettings.json names, or null when `path` is not an SDK. */
function versionOf(path: string): string | null {
  const settings = join(path, "SDKSettings.json");
  if (!existsSync(settings)) return null;
  const version = JSON.parse(readFileSync(settings, "utf8")).Version;
  return typeof version === "string" ? version : null;
}

/**
 * Where the macOS SDK of version {@link SDK_VERSION} is, looked for where
 * a build looks (`$MACOS_SDK_PATH`, `/opt/macos-sdk`, `/opt`: see
 * scripts/build/macos-sdk.ts) and then in what Xcode or the Command Line
 * Tools have (`$SDKROOT`, the one xcrun selects, a `MacOSX<version>.sdk`
 * beside it); or why there is none to read, telling an SDK of another
 * version (`found`) from no SDK at all.
 */
export function sdk(): Toolchain {
  if (toolchain) return toolchain;
  const pinned = `MacOSX${SDK_VERSION}.sdk`;
  const candidates = [
    process.env.MACOS_SDK_PATH,
    join("/opt/macos-sdk", pinned),
    join("/opt", pinned),
    process.env.SDKROOT,
  ];
  const xcrun = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
  let xcrunSays = "";
  if (xcrun.error || xcrun.status !== 0) {
    xcrunSays = ` (xcrun: ${(xcrun.error?.message ?? xcrun.stderr).trim()})`;
  } else {
    const selected = xcrun.stdout.trim();
    candidates.push(selected, join(dirname(selected), pinned));
  }
  let found: { path: string; version: string } | null = null;
  for (const path of candidates) {
    if (!path) continue;
    const version = versionOf(path);
    if (version === null) continue;
    if (version === SDK_VERSION) return (toolchain = { sdk: path, version });
    found ??= { path, version };
  }
  const reason = found
    ? `the macOS SDK here is ${found.version} (${found.path}) and the generated files track ${SDK_VERSION}, the version the build pins (MACOS_SDK_VERSION in scripts/build/macos-sdk.ts); install the Xcode or Command Line Tools that carry MacOSX${SDK_VERSION}.sdk, or point MACOS_SDK_PATH at one`
    : `no macOS SDK found${xcrunSays}; install Xcode or the Command Line Tools, or set MACOS_SDK_PATH`;
  return (toolchain = { sdk: null, version: null, reason, found });
}

/**
 * Read `path` instead of looking for the pinned SDK: what the build does,
 * so that the tables it generates describe the SDK it links.
 */
export function useSdk(path: string): void {
  const version = versionOf(path);
  if (version === null) throw new Error(`${path} is not a macOS SDK (no SDKSettings.json)`);
  toolchain = { sdk: path, version };
}

function sdkOrThrow(): { sdk: string; version: string } {
  const t = sdk();
  if (t.sdk === null) throw new Error(t.reason);
  return t;
}

// ─────────────────────────────── output files ───────────────────────────────

/** The first line of a generated file: the SDK version it was read from. */
function stamp(): string {
  return `// macOS SDK ${toolchain?.sdk ? toolchain.version : SDK_VERSION}.\n`;
}

/**
 * Write `body` under the stamp line to `out` (without one when `stamp` is
 * false, for output that does not vary with the SDK), or with `--check` on
 * the command line report whether what is there differs, stamp included,
 * and make the exit code 1 if so.
 */
export function stamped(out: string, body: string, stamped = true): void {
  const script = `bun scripts/${process.argv[1]?.split("/").at(-1) ?? ""}`;
  if (process.argv.includes("--check")) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current !== (stamped ? stamp() : "") + body) {
      console.error(`${out} is stale; run ${script}`);
      process.exitCode = 1;
      return;
    }
    console.error(`${out} OK`);
  } else {
    sdkOrThrow();
    writeFileSync(out, (stamped ? stamp() : "") + body);
    console.error(`wrote ${out}`);
  }
}

// ─────────────────────────────── clang's AST ────────────────────────────────

export type Arch = "arm64" | "x86_64";

/**
 * The translation unit importing {@link HEADERS} for `arch`: its
 * preprocessed text (`clang -E`, line markers included) and the
 * `-ast-dump` of that text. Dumping the preprocessed text rather than the
 * headers makes a type carrying an attribute written as a macro (`NSURL
 * *homeDirectory API_AVAILABLE(…)`) print with its nullability (`NSURL *
 * _Nonnull`) rather than as `API_AVAILABLE NSURL *`, and makes every source
 * location a plain file and line (no macro expansion ranges); the line
 * markers keep those locations in terms of the SDK's headers.
 */
const units = new Map<Arch, { ast: string; source: string }>();

export function translationUnit(arch: Arch): { ast: string; source: string } {
  const cached = units.get(arch);
  if (cached) return cached;
  const { sdk: SDK, version } = sdkOrThrow();
  const dir = mkdtempSync(join(tmpdir(), "appkit-sdk-"));
  try {
    const source = join(dir, "frameworks.m");
    writeFileSync(source, HEADERS.map(h => `#import <${h}>\n`).join(""));
    const [driver, ...lead] = process.platform === "darwin" ? ["xcrun", "clang"] : ["clang"];
    // An explicit target rather than `-arch`, so any clang (the Linux one
    // that cross-compiles the darwin build too) reads the SDK the same way.
    const target = `${arch}-apple-macos${version}`;
    const run = (args: string[]) => {
      const clang = spawnSync(
        driver,
        [...lead, "-target", target, "-isysroot", SDK, "-fno-color-diagnostics", ...args],
        {
          encoding: "utf8",
          maxBuffer: 1 << 30,
        },
      );
      if (clang.error) throw clang.error;
      if (clang.status !== 0) throw new Error(`clang ${args.join(" ")} failed:\n${clang.stderr}`);
      return clang.stdout;
    };
    const preprocessed = join(dir, "frameworks.mi");
    run(["-E", source, "-o", preprocessed]);
    const unit = {
      source: readFileSync(preprocessed, "utf8"),
      // The bodies of inline functions (thousands, in <simd/simd.h>) carry nothing the generators read.
      ast: run(["-fsyntax-only", "-Xclang", "-skip-function-bodies", "-Xclang", "-ast-dump", preprocessed]),
    };
    units.set(arch, unit);
    return unit;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export type Loc = { file: string; line: number; col: number };

export type AstLine = {
  /** The line as clang printed it. */
  line: string;
  /** 1 for the translation unit's children; 0 for a line that is not a node. */
  depth: number;
  /** The node: its kind, address and the rest, less the source range after the address. */
  body: string;
  /** `ObjCMethodDecl`, `ParmVarDecl`, …; "" for a line that is not a node. */
  kind: string;
  /** The node's source range, when it prints one (in terms of the SDK headers). */
  begin: Loc | null;
  end: Loc | null;
};

const LOC =
  /<invalid sloc>|((?:\/[^:<>,]*|<scratch space>|<built-in>|<command line>)(?=:\d)|line|col):(\d+)(?::(\d+))?/g;

/**
 * The lines of an `-ast-dump`, with each node's depth in the tree and its
 * source range. clang prints a location's file only when it differs from
 * the previous location it printed, and its line only when that differs,
 * so the ranges are recovered by carrying both along the whole dump.
 */
export function* astLines(text: string): Generator<AstLine> {
  let file = "";
  let lineNo = 0;
  const read = (m: RegExpExecArray): Loc | null => {
    if (m[1] === undefined) return null; // <invalid sloc>
    if (m[1] === "col") return { file, line: lineNo, col: Number(m[2]) };
    if (m[1] !== "line") file = m[1];
    lineNo = Number(m[2]);
    return { file, line: lineNo, col: Number(m[3] ?? 0) };
  };
  let at = 0;
  while (at < text.length) {
    let next = text.indexOf("\n", at);
    if (next < 0) next = text.length;
    const line = text.slice(at, next);
    at = next + 1;
    const marker = line.search(/[|`]-[A-Za-z<]/);
    if (marker < 0) {
      yield { line, depth: 0, body: line, kind: "", begin: null, end: null };
      continue;
    }
    const node = line.slice(marker + 2);
    // `Kind 0xaddr [prev 0xaddr] [parent 0xaddr] <begin[, end]> loc …`: the
    // locations up to and including the node's own are read in order for
    // the file/line they carry forward; the body keeps everything but the range.
    const head = /^(\w+ 0x[0-9a-f]+ (?:(?:prev|parent) 0x[0-9a-f]+ )*)<([^<>]*(?:<[^<>]*>[^<>]*)*)> ?/.exec(node);
    let begin: Loc | null = null;
    let end: Loc | null = null;
    let body = node;
    if (head) {
      LOC.lastIndex = 0;
      const first = LOC.exec(head[2]);
      begin = first ? read(first) : null;
      const second = first ? LOC.exec(head[2]) : null;
      end = second ? read(second) : begin;
      body = head[1] + node.slice(head[0].length);
      // The node's own location follows the range (or `col:N`/`line:N:M` alone).
      const own = /^(\w+ 0x[0-9a-f]+ (?:(?:prev|parent) 0x[0-9a-f]+ )*)((?:\/[^:<>, ]*|line|col):\d+(?::\d+)? )/.exec(
        body,
      );
      if (own) {
        LOC.lastIndex = 0;
        const m = LOC.exec(own[2]);
        if (m) read(m);
      }
    }
    yield { line, depth: marker / 2 + 1, body, kind: /^[A-Za-z]+/.exec(body)?.[0] ?? "", begin, end };
  }
}

export type CType = { sugar: string; canon: string };

/** `'NSString * _Nonnull':'NSString *'` (as written : desugared one level) or a lone `'void'`. */
export function typesIn(text: string): CType | null {
  const m = /'([^']*)'(?::'([^']*)')?/.exec(text);
  return m ? { sugar: m[1], canon: m[2] ?? m[1] } : null;
}

// ───────────────────────────── the source text ──────────────────────────────

/**
 * The preprocessed translation unit, addressable by the header locations
 * clang reports (its line markers say which header and line each of its
 * own lines is).
 */
export class Source {
  readonly lines: string[];
  /** header path -> header line -> the indexes into `lines` carrying that header line (a `_Pragma` in a macro splits one header line over several). */
  private readonly index = new Map<string, Map<number, number[]>>();

  constructor(text: string) {
    this.lines = text.split("\n");
    let file = "";
    let next = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const marker = /^# (\d+) "(.*)"/.exec(this.lines[i]);
      if (marker) {
        file = marker[2];
        next = Number(marker[1]);
        continue;
      }
      let lines = this.index.get(file);
      if (!lines) this.index.set(file, (lines = new Map()));
      const at = lines.get(next);
      if (at) at.push(i);
      else lines.set(next, [i]);
      next++;
    }
  }

  /** The indexes into `lines` of header `loc.file` line `loc.line` (usually one). */
  linesOf(loc: Loc): number[] {
    return this.index.get(loc.file)?.get(loc.line) ?? [];
  }

  /** The index into `lines` where `starts` is at `loc`'s column, among the lines carrying that header line; else the first of them, or -1. */
  lineOf(loc: Loc, starts = /\S/): number {
    const candidates = this.linesOf(loc);
    for (const i of candidates) {
      if (starts.test(this.lines[i].slice(loc.col - 1, loc.col + 8))) return i;
    }
    return candidates[0] ?? -1;
  }

  /**
   * The declaration starting at `begin` (a `-`, `+` or `@`) and running to
   * its `;` or the end of the header line `end` is on, whichever is first.
   */
  declaration(begin: Loc, end: Loc): string {
    const first = this.lineOf(begin, /^[-+@]/);
    const last = this.linesOf(end).at(-1) ?? -1;
    if (first < 0 || last < 0 || last < first) return "";
    let text = this.lines[first].slice(begin.col - 1);
    for (let i = first + 1; i <= last; i++) text += "\n" + this.lines[i];
    const semicolon = text.indexOf(";");
    return semicolon < 0 ? text : text.slice(0, semicolon + 1);
  }

  /** Whether an `@interface`/`@protocol` whose range ends at `loc` ends with `@end` there (a definition) rather than at its own name (a forward declaration). */
  atEnd(loc: Loc): boolean {
    return this.linesOf(loc).some(
      i => /^\s*@end\b/.test(this.lines[i]) || this.lines[i].startsWith("end", loc.col - 1),
    );
  }

  /**
   * The `@optional` / `@required` directives between `begin` and `end`, in
   * order, each with its position as (index into `lines`, column).
   */
  directives(begin: Loc, end: Loc): { at: [number, number]; optional: boolean }[] {
    const out: { at: [number, number]; optional: boolean }[] = [];
    const first = this.lineOf(begin, /^@/);
    const last = this.linesOf(end).at(-1) ?? -1;
    if (first < 0 || last < 0) return out;
    for (let i = first; i <= last; i++) {
      for (const m of this.lines[i].matchAll(/@(optional|required)\b/g)) {
        out.push({ at: [i, m.index + 1], optional: m[1] === "optional" });
      }
    }
    return out;
  }
}

// ─────────────────────────────── the model ───────────────────────────────────

export type Param = {
  name: string;
  type: CType;
  /** The Objective-C qualifiers written before the type, as encoded: `n` in, `N` inout, `o` out, `O` bycopy, `R` byref, `V` oneway. */
  qualifiers: string;
  /** The type as written in the header (`const ObjectType _Nonnull [_Nullable]`), when the method is not implicit. */
  written: string | null;
  /** NS_RELEASES_ARGUMENT / CF_RELEASES_ARGUMENT: the method takes over the caller's reference. */
  consumed: boolean;
  /** CF_RETURNS_RETAINED / NS_RETURNS_RETAINED on an out-parameter: what the callee stores there is the caller's to release. */
  retainedOut: boolean;
};

export type Method = {
  selector: string;
  isClass: boolean;
  returns: CType;
  /** As {@link Param.qualifiers}, for the result (`V` for `oneway void`). */
  returnsQualifiers: string;
  params: Param[];
  /** Declared with `, ...`. */
  variadic: boolean;
  /** NS_REQUIRES_NIL_TERMINATION. */
  sentinel: boolean;
  /** NS_RETURNS_RETAINED / NS_RETURNS_NOT_RETAINED (or the CF forms): the result's ownership, where declared against the selector's naming family. */
  returnsRetained: boolean | null;
  /** NS_REPLACES_RECEIVER (`ns_consumes_self`): the method takes over the caller's reference to the receiver, as an `init` does. */
  consumesSelf: boolean;
  /** NS_FORMAT_FUNCTION(F, A) and the C-string kinds: the format kind, F and A as written (1-based; A is 0 for a `va_list` variant). */
  format: { kind: string; format: number; first: number } | null;
  /** Unavailable on macOS (API_UNAVAILABLE, NS_UNAVAILABLE). */
  unavailable: boolean;
  /** The macOS version and message, when deprecated. */
  deprecated: string | null;
  /** The macOS version that introduced it, when the header says. */
  introduced: string | null;
  /** `@optional` in its protocol. */
  optional: boolean;
  /** Synthesized by clang for a property (its getter or setter) rather than written. */
  implicit: boolean;
  /** Declared in a category (or a class extension, "") rather than the class's own `@interface`; null otherwise. */
  category: string | null;
  /** The class or protocol that declares it. */
  owner: string;
  ownerKind: "interface" | "protocol";
  /** The header it is declared in. */
  file: string;
  begin: Loc;
  end: Loc;
};

export type Property = {
  name: string;
  type: CType;
  /** `readonly`, `assign`, `weak`, `copy`, `class`, … as clang lists them (defaults included). */
  attributes: Set<string>;
  /** The setter's selector (as renamed by `setter=`), whether or not the property is readonly. */
  setter: string;
  unavailable: boolean;
  optional: boolean;
  category: string | null;
  owner: string;
  ownerKind: "interface" | "protocol";
  file: string;
};

export type Interface = {
  name: string;
  superclass: string | null;
  /** The protocols the class and its categories adopt. */
  protocols: Set<string>;
  methods: Method[];
  properties: Property[];
  /** The header of its `@interface … @end` (null for a class only forward-declared here). */
  file: string | null;
  /** NS_SWIFT_UI_ACTOR: AppKit's statement that only the main thread may use it. */
  mainActor: boolean;
};

export type Protocol = {
  name: string;
  /** The protocols it incorporates. */
  inherits: Set<string>;
  methods: Method[];
  properties: Property[];
  /** The header of its `@protocol … @end` (null for one only forward-declared here). */
  file: string | null;
};

export type Field = { name: string; type: CType; bits: number | null };

export type Struct = {
  kind: "struct" | "union";
  /** The tag (`_NSRange`), which is what a type encoding names; null for an anonymous one (`?`). */
  tag: string | null;
  fields: Field[];
  /** Has a definition (fields known); a forward-declared or opaque struct has not. */
  complete: boolean;
  /** `__attribute__((packed))`. */
  packed: boolean;
  /** `#pragma pack(N)` in bytes, or 0. */
  maxAlign: number;
  /** The class `CF_BRIDGED_TYPE(…)` on its first declaration names (`NSString` for `__CFString`, `id` for any object), or null. */
  bridged: string | null;
};

export type CFunction = {
  returns: CType;
  params: Param[];
  variadic: boolean;
  format: Method["format"];
  /** As {@link Method.returnsRetained}: CF_RETURNS_RETAINED / CF_RETURNS_NOT_RETAINED (or the NS forms) against the Create/Copy naming rule. */
  returnsRetained: boolean | null;
  /** Declared `extern` (by some declaration of it). */
  exported: boolean;
  /** The header of its first declaration. */
  file: string;
};

export type Ast = {
  arch: Arch;
  interfaces: Map<string, Interface>;
  protocols: Map<string, Protocol>;
  /** A typedef's (or an interface's type parameter's) underlying type. */
  typedefs: Map<string, CType>;
  /** An enumeration's underlying integer type (`NSWindowStyleMask` -> `unsigned long`). */
  enums: Map<string, CType>;
  functions: Map<string, CFunction>;
  /**
   * Structs and unions by every name a type can reach them under: `struct
   * _NSRange`, the typedef of an anonymous one (`MTLSize`), and
   * `@file:line:col` for an anonymous one nested in another.
   */
  structs: Map<string, Struct>;
  /** `void *` typedefs the headers bridge to `id` (`CFTypeRef`, `CFPropertyListRef`): objects to the bridge, `^v` to the compiler. */
  objectTypedefs: Set<string>;
  source: Source;
};

/** Whether `file` is a header of one of `frameworks` (`X.framework/Headers/…`, `X.framework/Frameworks/Y.framework/Headers/…` counts for Y). */
export function inFramework(file: string | null, frameworks: readonly string[]): boolean {
  if (!file) return false;
  const m = /\/([A-Za-z0-9_]+)\.framework\/(?:Versions\/[^/]+\/)?Headers\//.exec(file);
  return m !== null && frameworks.includes(m[1]);
}

/** Comments and string literals may contain anything; neither is part of a declaration. (The preprocessed text has no comments; string literals remain.) */
function stripStrings(text: string): string {
  return text.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** The index just past the `)` that closes the `(` at `open`. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}

/**
 * `- (id)initWithObjects:(const ObjectType [])objects count:(NSUInteger)cnt`
 * -> the return type text and each parameter's (keyword, type text, name);
 * a parameter with no `(type)` is an `id`; attribute groups are skipped.
 */
export function parseMethodText(
  decl: string,
): { returns: string; params: { keyword: string; type: string; name: string }[] } | null {
  let i = decl.indexOf("(");
  if (i < 0) return null;
  const close = closeParen(decl, i);
  const returns = decl.slice(i + 1, close - 1).trim();
  i = close;
  const params: { keyword: string; type: string; name: string }[] = [];
  let unary: string | null = null;
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*/;
  const spaces = /^\s*/;
  while (i < decl.length) {
    i += spaces.exec(decl.slice(i))![0].length;
    const word = identifier.exec(decl.slice(i))?.[0] ?? "";
    let j = i + word.length;
    j += spaces.exec(decl.slice(j))![0].length;
    if (decl[j] === ":") {
      j += 1 + spaces.exec(decl.slice(j + 1))![0].length;
      let type = "id";
      if (decl[j] === "(") {
        const end = closeParen(decl, j);
        type = decl.slice(j + 1, end - 1).trim();
        j = end + spaces.exec(decl.slice(end))![0].length;
      }
      // `__attribute__((noescape))` may precede the name.
      while (decl.startsWith("__attribute__", j)) {
        const open = decl.indexOf("(", j);
        j = closeParen(decl, open);
        j += spaces.exec(decl.slice(j))![0].length;
      }
      const name = identifier.exec(decl.slice(j))?.[0] ?? "";
      params.push({ keyword: word, type, name });
      i = j + name.length;
    } else if (word) {
      if (params.length === 0) unary ??= word;
      i = j;
    } else if (decl[i] === "(") {
      i = closeParen(decl, i);
    } else if (decl[i] === "," || decl[i] === ";") {
      break;
    } else {
      i++;
    }
  }
  if (params.length === 0 && unary === null) return null;
  return { returns, params };
}

/** The encoded Objective-C parameter qualifiers leading a type as written (`out NSError **` -> `o`), in the order clang emits them. */
function qualifiersOf(written: string): string {
  const words = new Set(written.match(/\b(in|inout|out|bycopy|byref|oneway)\b(?=[\s\w(*^])/g) ?? []);
  let out = "";
  if (words.has("in")) out += "n";
  if (words.has("inout")) out += "N";
  if (words.has("out")) out += "o";
  if (words.has("bycopy")) out += "O";
  if (words.has("byref")) out += "R";
  if (words.has("oneway")) out += "V";
  return out;
}

/**
 * Read the dump into the model. Every `ObjCInterfaceDecl` node of a class
 * (its definition, each `@class` mention) contributes to one Interface;
 * categories put their methods on their class; a method's or property's
 * `optional` comes from the `@optional`/`@required` directives in the
 * source text, which the dump does not carry.
 */
export function parse(arch: Arch, tu: { ast: string; source: string }): Ast {
  const source = new Source(tu.source);
  const interfaces = new Map<string, Interface>();
  const protocols = new Map<string, Protocol>();
  const typedefs = new Map<string, CType>();
  const enums = new Map<string, CType>();
  const functions = new Map<string, CFunction>();
  const structs = new Map<string, Struct>();
  const objectTypedefs = new Set<string>();

  const interfaceNamed = (name: string): Interface => {
    let found = interfaces.get(name);
    if (!found) {
      found = {
        name,
        superclass: null,
        protocols: new Set(),
        methods: [],
        properties: [],
        file: null,
        mainActor: false,
      };
      interfaces.set(name, found);
    }
    return found;
  };
  const protocolNamed = (name: string): Protocol => {
    let found = protocols.get(name);
    if (!found) protocols.set(name, (found = { name, inherits: new Set(), methods: [], properties: [], file: null }));
    return found;
  };

  // The declaration at depth 1 whose children are being read, and where its
  // methods go once known (a category names its class in a child node).
  type Container = {
    kind: "interface" | "category" | "protocol";
    /** The category's name ("" for a class extension); null otherwise. */
    category: string | null;
    target: Interface | Protocol | null;
    pending: (Method | Property)[];
    pendingProtocols: string[];
    begin: Loc;
    end: Loc;
    /** Directives in the container's text, for `optional`. */
    directives: { at: [number, number]; optional: boolean }[] | null;
  };
  let container: Container | null = null;
  let method: Method | null = null;
  /** The declaration text of `method` as parsed, for its parameters' qualifiers and array declarators. */
  let declared: ReturnType<typeof parseMethodText> = null;
  let property: { node: Property; depth: number } | null = null;
  let cFunction: { node: CFunction; depth: number } | null = null;
  let voidTypedef: { depth: number; name: string } | null = null;
  /** Open RecordDecls by depth, innermost last. */
  const records: { depth: number; struct: Struct; begin: Loc | null }[] = [];
  let field: { depth: number; node: Field } | null = null;
  /** The anonymous struct just closed at depth 1, for the typedef naming it that follows. */
  let lastAnonymous: Struct | null = null;

  const optionalAt = (c: Container, begin: Loc): boolean => {
    if (c.kind !== "protocol") return false;
    c.directives ??= source.directives(c.begin, c.end);
    const line = source.lineOf(begin, /^[-+@]/);
    let optional = false;
    for (const d of c.directives) {
      if (d.at[0] < line || (d.at[0] === line && d.at[1] < begin.col)) optional = d.optional;
      else break;
    }
    return optional;
  };
  const place = (c: Container, m: Method | Property) => {
    if (c.target === null) c.pending.push(m);
    else if ("selector" in m) c.target.methods.push(m);
    else c.target.properties.push(m);
  };

  for (const { line, depth, body, kind, begin, end } of astLines(tu.ast)) {
    if (depth === 0) continue;
    if (field && depth <= field.depth) field = null;
    while (records.length > 0 && depth <= records.at(-1)!.depth) {
      const closed = records.pop()!;
      if (closed.depth === 1 && closed.struct.tag === null) lastAnonymous = closed.struct;
    }
    if (property && depth <= property.depth) property = null;
    if (cFunction && depth <= cFunction.depth) cFunction = null;

    if (kind === "RecordDecl") {
      // `RecordDecl 0x… [parent 0x…] <range> loc [implicit] (struct|union) [Name] [definition]`
      const m = /\s(struct|union)(?: (?!definition$)([A-Za-z_]\w*))?( definition)?\s*$/.exec(body);
      if (m) {
        const key = m[2] ? `${m[1]} ${m[2]}` : null;
        let struct = key ? structs.get(key) : undefined;
        if (!struct || (m[3] && !struct.complete)) {
          const fresh: Struct = {
            kind: m[1] as "struct" | "union",
            tag: m[2] ?? null,
            fields: [],
            complete: Boolean(m[3]),
            packed: false,
            maxAlign: 0,
            bridged: struct?.bridged ?? null,
          };
          if (struct) Object.assign(struct, fresh);
          else struct = fresh;
        }
        if (key) structs.set(key, struct);
        if (begin) structs.set(`@${begin.file}:${begin.line}:${begin.col}`, struct);
        records.push({ depth, struct, begin });
        if (depth === 1) lastAnonymous = null;
      }
      continue;
    }
    if (records.length > 0) {
      const open = records.at(-1)!;
      // `value: Int 8` under a FieldDecl's ConstantExpr: the bit-field width.
      if (field && kind === "value") {
        const bits = /^value: Int (\d+)$/.exec(body);
        if (bits) field.node.bits ??= Number(bits[1]);
        continue;
      }
      if (depth === open.depth + 1) {
        if (kind === "FieldDecl") {
          // `FieldDecl 0x… <range> loc [implicit] [referenced] [name] 'type'[:'canon']`
          const m = /\s(?:(?!implicit |referenced )([A-Za-z_]\w*) )?('.*')\s*$/.exec(body);
          const type = m ? typesIn(m[2]) : null;
          if (m && type) {
            const node: Field = { name: m[1] ?? "", type, bits: null };
            open.struct.fields.push(node);
            field = { depth, node };
          }
        } else if (kind === "PackedAttr") {
          open.struct.packed = true;
        } else if (kind === "MaxFieldAlignmentAttr") {
          const bits = /(\d+)\s*$/.exec(body);
          if (bits) open.struct.maxAlign = Number(bits[1]) / 8;
        } else if (kind === "ObjCBridgeAttr") {
          // `ObjCBridgeAttr 0x… [Inherited] NSString`; a mutable variant (`ObjCBridgeMutableAttr`) is another node kind.
          open.struct.bridged ??= /\s(\w+)\s*$/.exec(body)?.[1] ?? null;
        }
      }
      if (kind !== "TypedefDecl") continue;
    }

    if (kind === "EnumDecl") {
      // `EnumDecl 0x… col:32 NSWindowStyleMask 'NSUInteger':'unsigned long'`
      const m = /\s([A-Za-z_][A-Za-z0-9_]*) ('.*')\s*$/.exec(body);
      const type = m ? typesIn(m[2]) : null;
      if (m && type && !/^(col|line)$/.test(m[1])) enums.set(m[1], type);
      if (depth !== 1) continue;
    }
    if (kind === "TypedefDecl" || kind === "ObjCTypeParamDecl") {
      // `TypedefDecl 0x… col:14 [referenced] NSInteger 'long'`, `ObjCTypeParamDecl 0x… col:16 ObjectType [covariant] 'id'`
      const m = /\s([A-Za-z_][A-Za-z0-9_]*)(?: (?:covariant|contravariant))?(?: bounded)? ('.*')\s*$/.exec(body);
      const type = m ? typesIn(m[2]) : null;
      if (m && type && !["id", "Class", "SEL", "instancetype", "BOOL"].includes(m[1])) {
        // A type parameter is read as its bound everywhere (the bridge sees `id`).
        if (kind === "TypedefDecl" || !typedefs.has(m[1])) typedefs.set(m[1], type);
        // `typedef struct {…} MTLSize;`: clang prints the struct as `MTLSize` from here on.
        const anonymous = /^(struct|union) ([A-Za-z_]\w*)$/.exec(type.sugar);
        if (kind === "TypedefDecl" && anonymous && type.canon === anonymous[2] && lastAnonymous) {
          structs.set(anonymous[2], lastAnonymous);
          structs.set(type.sugar, lastAnonymous);
        }
      }
      lastAnonymous = null;
      voidTypedef =
        m && type && kind === "TypedefDecl" && /^(const )?void \*$/.test(type.canon) ? { depth, name: m[1] } : null;
      if (depth !== 1) continue;
    } else if (voidTypedef !== null) {
      // `typedef const CF_BRIDGED_TYPE(id) void *CFTypeRef`: any object to the bridge (still `^v` to clang).
      if (depth > voidTypedef.depth && kind === "ObjCBridgeAttr" && / id\s*$/.test(body)) {
        objectTypedefs.add(voidTypedef.name);
        continue;
      }
      if (depth <= voidTypedef.depth) voidTypedef = null;
    }

    if (depth === 1) {
      if (container && container.target === null && container.pending.length > 0) {
        throw new Error(`category ${container.category} names no class`);
      }
      container = null;
      method = null;
      cFunction = null;
      if (kind === "FunctionDecl") {
        // `FunctionDecl 0x… [prev 0x…] <range> loc [implicit] [used] NSStringFromClass 'NSString * _Nonnull (Class _Nonnull)' [static|extern] [inline]`
        const m =
          /\s([A-Za-z_][A-Za-z0-9_]*) '([^']*)'(?::'[^']*')?((?: (?:extern|static|inline|implicit-inline))*)\s*$/.exec(
            body,
          );
        if (m && !/ implicit /.test(body) && begin) {
          // `Ret (A, B)`: the parameter list is the last top-level group (an attribute inside it has its own parentheses).
          let open = -1;
          if (m[2].endsWith(")")) {
            let nesting = 0;
            for (let i = m[2].length - 1; i >= 0; i--) {
              if (m[2][i] === ")") nesting++;
              else if (m[2][i] === "(" && --nesting === 0) {
                open = i;
                break;
              }
            }
          }
          const returns = (open < 0 ? m[2] : m[2].slice(0, open)).trim();
          const list = open < 0 ? "" : m[2].slice(open + 1, -1);
          const exported = /\bextern\b/.test(m[3]);
          const node: CFunction = {
            returns: { sugar: returns, canon: returns },
            params: [],
            variadic: /(^|,\s*)\.\.\.\s*$/.test(list),
            format: null,
            returnsRetained: null,
            exported,
            file: begin.file,
          };
          cFunction = { node, depth };
          // A redeclaration repeats the parameters; the first declaration stands, later attributes still count.
          const before = functions.get(m[1]);
          if (before)
            cFunction.node = Object.assign(before, { params: [] as Param[], exported: before.exported || exported });
          else functions.set(m[1], node);
        }
        continue;
      }
      if (!begin || !end) continue;
      // `ObjCInterfaceDecl 0x… [prev 0x…] [loc] [implicit] Name`
      const name = /\s([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(body)?.[1] ?? null;
      const named = name !== null && !/^(col|line|prev|implicit|0x[0-9a-f]+)$/.test(name) && !name.includes(":");
      const defines = source.atEnd(end);
      const common = { pending: [], pendingProtocols: [], begin, end, directives: null };
      if (kind === "ObjCInterfaceDecl" && named) {
        const target = interfaceNamed(name);
        if (defines) target.file ??= begin.file;
        container = { kind: "interface", category: null, target, ...common };
      } else if (kind === "ObjCProtocolDecl" && named) {
        const target = protocolNamed(name);
        if (defines) target.file ??= begin.file;
        container = { kind: "protocol", category: null, target, ...common };
      } else if (kind === "ObjCCategoryDecl") {
        // A class extension `()` has no name of its own.
        container = { kind: "category", category: named ? name : "", target: null, ...common };
      }
      continue;
    }
    if (cFunction && depth === cFunction.depth + 1) {
      const fn = cFunction.node;
      if (kind === "ParmVarDecl") {
        // `ParmVarDecl 0x… col:40 format 'NSString * _Nonnull':'NSString *'` (unnamed in a few CoreGraphics declarations)
        const m = /\s([A-Za-z_][A-Za-z0-9_]*)? ?('.*')\s*$/.exec(body);
        const type = m ? typesIn(m[2]) : null;
        if (m && type) {
          fn.params.push({
            name: m[1] ?? "",
            type,
            qualifiers: "",
            written: null,
            consumed: false,
            retainedOut: false,
          });
        }
      } else if (kind === "FormatAttr") {
        const m = /\s(\w+) (\d+) (\d+)\s*$/.exec(body);
        if (m) fn.format = { kind: m[1], format: Number(m[2]), first: Number(m[3]) };
      } else if (kind === "NSReturnsRetainedAttr" || kind === "CFReturnsRetainedAttr") {
        fn.returnsRetained = true;
      } else if (kind === "NSReturnsNotRetainedAttr" || kind === "CFReturnsNotRetainedAttr") {
        fn.returnsRetained = false;
      }
      continue;
    }
    // A C function parameter's own attributes sit under its ParmVarDecl, the last parameter read.
    if (cFunction && depth === cFunction.depth + 2) {
      const param = cFunction.node.params.at(-1);
      if (param && (kind === "NSConsumedAttr" || kind === "CFConsumedAttr")) param.consumed = true;
      if (param && (kind === "NSReturnsRetainedAttr" || kind === "CFReturnsRetainedAttr")) param.retainedOut = true;
      continue;
    }
    if (!container) continue;

    if (depth === 2) {
      method = null;
      property = null;
      const quoted = /'([^']*)'/.exec(body)?.[1] ?? "";
      if (kind === "super" && container.kind === "interface") {
        (container.target as Interface).superclass = quoted;
      } else if (kind === "ObjCInterface" && container.kind === "category") {
        const target = interfaceNamed(quoted);
        container.target = target;
        for (const m of container.pending) place(container, m);
        for (const p of container.pendingProtocols) target.protocols.add(p);
        container.pending = [];
        container.pendingProtocols = [];
      } else if (kind === "ObjCProtocol") {
        if (container.kind === "protocol") (container.target as Protocol).inherits.add(quoted);
        else if (container.target) (container.target as Interface).protocols.add(quoted);
        else container.pendingProtocols.push(quoted);
      } else if (kind === "SwiftAttrAttr" && container.kind === "interface" && /"@(Main|UI)Actor"/.test(body)) {
        (container.target as Interface).mainActor = true;
      } else if (kind === "ObjCMethodDecl" && begin && end) {
        // `ObjCMethodDecl 0x… col:1 [implicit] [used] - setFrame:display: 'void' [variadic]`
        const m = /( implicit)?(?: (?:used|referenced))* ([-+]) (\S+) ('.*?')( variadic)?\s*$/.exec(body);
        const returns = m ? typesIn(m[4]) : null;
        if (!m || !returns) throw new Error(`cannot read the method in: ${line}`);
        const owner =
          container.kind === "category" ? ((container.target as Interface | null)?.name ?? "") : container.target!.name;
        method = {
          selector: m[3],
          isClass: m[2] === "+",
          returns,
          returnsQualifiers: "",
          params: [],
          variadic: Boolean(m[5]),
          sentinel: false,
          returnsRetained: null,
          consumesSelf: false,
          format: null,
          unavailable: false,
          optional: optionalAt(container, begin),
          deprecated: null,
          introduced: null,
          implicit: Boolean(m[1]),
          category: container.category,
          owner,
          ownerKind: container.kind === "protocol" ? "protocol" : "interface",
          file: begin.file,
          begin,
          end,
        };
        declared = null;
        if (!method.implicit) {
          // The qualifiers (`out NSError **`, `oneway void`) and array
          // declarators (`const ObjectType [])`) are only in the text.
          declared = parseMethodText(stripStrings(source.declaration(begin, end)));
          if (!declared)
            throw new Error(`cannot read the declaration of ${owner} ${m[3]} at ${begin.file}:${begin.line}`);
          method.returnsQualifiers = qualifiersOf(declared.returns);
        }
        place(container, method);
      } else if (kind === "ObjCPropertyDecl" && begin) {
        // `ObjCPropertyDecl 0x… col:36 delegate 'id<X> _Nullable':'id<X>' [required|optional] readonly atomic …`
        const m = /\s([A-Za-z_][A-Za-z0-9_]*) ('.*')((?: \w+)*)\s*$/.exec(body);
        const type = m ? typesIn(m[2]) : null;
        if (!m || !type) throw new Error(`cannot read the property in: ${line}`);
        const attributes = new Set(m[3].trim().split(/\s+/).filter(Boolean));
        const owner =
          container.kind === "category" ? ((container.target as Interface | null)?.name ?? "") : container.target!.name;
        const node: Property = {
          name: m[1],
          type,
          attributes,
          setter: `set${m[1][0].toUpperCase()}${m[1].slice(1)}:`,
          unavailable: false,
          optional: attributes.has("optional") || (!attributes.has("required") && optionalAt(container, begin)),
          category: container.category,
          owner,
          ownerKind: container.kind === "protocol" ? "protocol" : "interface",
          file: begin.file,
        };
        attributes.delete("optional");
        attributes.delete("required");
        property = { node, depth };
        place(container, node);
      }
      continue;
    }

    if (depth === 3 && property) {
      if (kind === "setter") {
        const m = /'([^']*)'/.exec(body);
        if (m) property.node.setter = m[1];
      } else if (kind === "UnavailableAttr") {
        property.node.unavailable = true;
      } else if (kind === "AvailabilityAttr") {
        const m = /\s(\w+) ([\d._]+) ([\d._]+) ([\d._]+)( Unavailable)? "/.exec(body);
        if (m && m[1] === "macos" && m[5]) property.node.unavailable = true;
      }
      continue;
    }
    if (depth === 3 && method) {
      if (kind === "ParmVarDecl") {
        // `ParmVarDecl 0x… col:43 [used] frameRect 'NSRect':'struct CGRect'`
        const m = /\s([A-Za-z_][A-Za-z0-9_]*)? ?('.*')\s*$/.exec(body);
        const type = m ? typesIn(m[2]) : null;
        if (!m || !type) throw new Error(`cannot read the parameter in: ${line}`);
        const written = declared?.params[method.params.length];
        method.params.push({
          name: m[1] ?? written?.name ?? "",
          type,
          qualifiers: written ? qualifiersOf(written.type) : "",
          written: written?.type ?? null,
          consumed: false,
          retainedOut: false,
        });
      } else if (kind === "NSReturnsRetainedAttr" || kind === "CFReturnsRetainedAttr") {
        method.returnsRetained = true;
      } else if (kind === "NSReturnsNotRetainedAttr" || kind === "CFReturnsNotRetainedAttr") {
        method.returnsRetained = false;
      } else if (kind === "NSConsumesSelfAttr") {
        method.consumesSelf = true;
      } else if (kind === "UnavailableAttr") {
        method.unavailable = true;
      } else if (kind === "AvailabilityAttr") {
        // `AvailabilityAttr 0x… macos 10.0 10.14 0 [Unavailable] "message" "replacement" …`
        const m = /\s(\w+) ([\d._]+) ([\d._]+) ([\d._]+)( Unavailable)? "(.*?)" "/.exec(body);
        if (m && m[1] === "macos") {
          if (m[5]) method.unavailable = true;
          if (m[2] !== "0") method.introduced = m[2].replace(/_/g, ".");
          if (m[3] !== "0") method.deprecated = `${m[3].replace(/_/g, ".")}${m[6] ? `: ${m[6]}` : ""}`;
        }
      } else if (kind === "DeprecatedAttr") {
        method.deprecated ??= /"(.*?)"/.exec(body)?.[1] ?? "";
      } else if (kind === "SentinelAttr") {
        method.sentinel = true;
      } else if (kind === "FormatAttr") {
        const m = /\s(\w+) (\d+) (\d+)\s*$/.exec(body);
        if (m) method.format = { kind: m[1], format: Number(m[2]), first: Number(m[3]) };
      }
      continue;
    }
    // A parameter's own attributes sit under its ParmVarDecl, which is the last parameter read.
    if (depth === 4 && method) {
      const param = method.params.at(-1);
      if (param && (kind === "NSConsumedAttr" || kind === "CFConsumedAttr")) param.consumed = true;
      if (param && (kind === "NSReturnsRetainedAttr" || kind === "CFReturnsRetainedAttr")) param.retainedOut = true;
    }
  }
  return { arch, interfaces, protocols, typedefs, enums, functions, structs, objectTypedefs, source };
}

const asts = new Map<Arch, Ast>();

/** {@link parse} of {@link translationUnit}, once per architecture. */
export function readSdk(arch: Arch): Ast {
  let ast = asts.get(arch);
  if (!ast) asts.set(arch, (ast = parse(arch, translationUnit(arch))));
  return ast;
}

// ─────────────────────────────── C types ─────────────────────────────────────

/**
 * A C type as far as the Objective-C type encoding and argument sizing
 * need to know it.
 */
export type Resolved =
  /** `enc` "" for what clang does not encode (SIMD vectors); `integral` for the at-least-int-sized rule of method frames. */
  | { kind: "scalar"; name: string; enc: string; size: number; align: number; integral: boolean }
  | { kind: "void" }
  /** `id`, `X *`, `id<P>`, `instancetype`; `class` names the interface when there is one. */
  | { kind: "object"; class: string | null }
  | { kind: "class" }
  | { kind: "sel" }
  | { kind: "block"; returns: Resolved; params: Resolved[] }
  | { kind: "function" }
  /** `viaTypedef`: the pointer type was written as a typedef name (`CFStringRef`, `NSRectArray`), which changes where clang looks for `const`. */
  | { kind: "pointer"; to: Resolved; const: boolean; viaTypedef: boolean; topConst: boolean }
  | { kind: "array"; of: Resolved; count: number | null }
  | { kind: "struct"; struct: Struct | null; tag: string | null; union: boolean }
  | { kind: "unknown"; text: string };

const SCALARS: Record<string, { enc: [arm: string, intel: string]; size: number; integral: boolean }> = {
  "char": { enc: ["c", "c"], size: 1, integral: true },
  "signed char": { enc: ["c", "c"], size: 1, integral: true },
  "unsigned char": { enc: ["C", "C"], size: 1, integral: true },
  "short": { enc: ["s", "s"], size: 2, integral: true },
  "unsigned short": { enc: ["S", "S"], size: 2, integral: true },
  "int": { enc: ["i", "i"], size: 4, integral: true },
  "unsigned int": { enc: ["I", "I"], size: 4, integral: true },
  "long": { enc: ["q", "q"], size: 8, integral: true },
  "unsigned long": { enc: ["Q", "Q"], size: 8, integral: true },
  "long long": { enc: ["q", "q"], size: 8, integral: true },
  "unsigned long long": { enc: ["Q", "Q"], size: 8, integral: true },
  "__int128": { enc: ["t", "t"], size: 16, integral: true },
  "unsigned __int128": { enc: ["T", "T"], size: 16, integral: true },
  "wchar_t": { enc: ["i", "i"], size: 4, integral: true },
  "char16_t": { enc: ["S", "S"], size: 2, integral: true },
  "char32_t": { enc: ["I", "I"], size: 4, integral: true },
  "bool": { enc: ["B", "B"], size: 1, integral: true },
  "_Bool": { enc: ["B", "B"], size: 1, integral: true },
  // The one type the two architectures spell differently: `bool` on arm64, `signed char` on x86_64.
  "BOOL": { enc: ["B", "c"], size: 1, integral: true },
  "_Float16": { enc: ["", ""], size: 2, integral: false },
  "__fp16": { enc: ["", ""], size: 2, integral: false },
  "float": { enc: ["f", "f"], size: 4, integral: false },
  "double": { enc: ["d", "d"], size: 8, integral: false },
  "long double": { enc: ["D", "D"], size: 16, integral: false },
};

/** The scalar encodings the bridge converts (`Scalar::of` and `Enc::parse` in src/appkit/objc/dynamic.rs). */
const BRIDGE_SCALARS = /^[BcCsSiIlLqQfd]$/;

/**
 * Turns declared types into {@link Resolved} ones for one parsed SDK,
 * following typedefs, type parameters, enums and struct definitions.
 */
export class Types {
  private readonly memo = new Map<string, Resolved>();
  /**
   * `bridged`: read the `void *` typedefs the headers bridge to `id`
   * (`CFTypeRef`, `CFPropertyListRef`) as the objects the bridge passes
   * them as, rather than as the `^v` clang encodes.
   */
  /**
   * `written`: encodings for the bridge to read as a script's own (`objc.fn`,
   * `objc.block`, `defineClass` types), where `B` is `BOOL` and `c` a
   * `char` on both architectures, rather than as the runtime reports them
   * (`c` for both on x86_64).
   */
  constructor(
    readonly ast: Ast,
    readonly bridged = false,
    readonly written = false,
  ) {}

  /** The scalar encoding for this architecture. */
  private scalar(name: string): Resolved {
    const s = SCALARS[name];
    return {
      kind: "scalar",
      name,
      enc: this.written && name === "BOOL" ? "B" : s.enc[this.ast.arch === "arm64" ? 0 : 1],
      size: s.size,
      align: s.size,
      integral: s.integral,
    };
  }

  /** Resolve a type as clang printed it (the `sugar` of a {@link CType}, or a typedef's expansion). */
  resolve(printed: string, depth = 0): Resolved {
    const hit = this.memo.get(printed);
    if (hit) return hit;
    const out = this.resolveUncached(printed, depth);
    this.memo.set(printed, out);
    return out;
  }

  private resolveUncached(printed: string, depth: number): Resolved {
    if (depth > 40) return { kind: "unknown", text: printed };
    let t = printed;
    // Vectors: `float __attribute__((ext_vector_type(4)))`, `__attribute__((neon_vector_type(8))) int8_t`, `__attribute__((__vector_size__(16 * sizeof(signed char)))) signed char`.
    const vector =
      /__attribute__\(\((?:ext_vector_type|neon_vector_type|neon_polyvector_type)\((\d+)\)\)\)/.exec(t) ??
      /__attribute__\(\(__vector_size__\((\d+) \* sizeof\([^()]*\)\)\)\)/.exec(t) ??
      /__attribute__\(\(matrix_type\((\d+), (\d+)\)\)\)/.exec(t);
    if (vector) {
      const element = this.resolve(t.replace(vector[0], " ").replace(/\s+/g, " ").trim(), depth + 1);
      const elementSize = element.kind === "scalar" ? element.size : 4;
      // `__vector_size__` counts bytes, the others lanes; three lanes take the room of four.
      const bytes = vector[0].includes("__vector_size__")
        ? Number(vector[1])
        : Number(vector[1]) * (vector[2] ? Number(vector[2]) : 1) * elementSize;
      const size = 1 << Math.ceil(Math.log2(bytes));
      return { kind: "scalar", name: "vector", enc: "", size, align: Math.min(size, 16), integral: false };
    }
    t = t
      .replace(/__attribute__\(\((?:[^()]|\([^()]*(?:\([^()]*\)[^()]*)*\))*\)\)/g, " ")
      .replace(
        /\b(volatile|restrict|_Nonnull|_Nullable_result|_Nullable|_Null_unspecified|__strong|__weak|__unsafe_unretained|__autoreleasing|__kindof|_Atomic|__ptrauth\([^)]*\))\b/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

    // A block or function pointer, or a function type: the declarator is the last top-level `(^…)`/`(*…)` group before the parameter list.
    const fn = /\((anonymous|unnamed)\b/.test(t) ? null : splitDeclarator(t);
    if (fn) {
      if (fn.declarator === null) return { kind: "function" };
      const inner = fn.declarator.trim();
      if (inner.startsWith("^")) {
        // `^`, `^ const`, `^ *` (a pointer to a block)…
        const rest = inner
          .slice(1)
          .replace(/\bconst\b/g, "")
          .trim();
        const block: Resolved = {
          kind: "block",
          returns: this.resolve(fn.returns, depth + 1),
          params: splitParams(fn.params).map(p => this.resolve(p, depth + 1)),
        };
        return this.wrapPointers(block, rest);
      }
      if (inner.startsWith("*")) {
        const rest = inner
          .slice(1)
          .replace(/\bconst\b/g, "")
          .trim();
        const pointer: Resolved = {
          kind: "pointer",
          to: { kind: "function" },
          const: false,
          viaTypedef: false,
          topConst: false,
        };
        return this.wrapPointers(pointer, rest);
      }
      return { kind: "unknown", text: printed };
    }

    // Arrays: `unsigned short[8]`, `float[3]`, `id[]`, `const CGFloat[_Nullable 4]`.
    const array = /^(.*)\[\s*(\d*)\s*\]$/.exec(t);
    if (array) {
      // `T[4][4]`: the element is `T[4]`… clang prints the outer dimension first.
      const dims: (number | null)[] = [];
      let rest = t;
      for (let m = /^(.*)\[\s*(\d*)\s*\]$/.exec(rest); m; m = /^(.*)\[\s*(\d*)\s*\]$/.exec(rest)) {
        dims.push(m[2] === "" ? null : Number(m[2]));
        rest = m[1].trim();
      }
      let element = this.resolve(rest, depth + 1);
      for (let i = 0; i < dims.length; i++) element = { kind: "array", of: element, count: dims[i] };
      return element;
    }

    // Pointers: the last `*` is the outermost. `X *const` is a const pointer; `const X *` a pointer to const.
    if (t.endsWith("*") || /\*\s*const$/.test(t)) {
      const topConst = /\*\s*const$/.test(t);
      const pointee = t.replace(/\*\s*(const)?$/, "").trim();
      const to = this.resolve(pointee, depth + 1);
      // An Objective-C object pointer is one thing, not a pointer to a thing.
      if (to.kind === "object" && this.isObjectType(pointee)) return to;
      return { kind: "pointer", to, const: isConstQualified(pointee, this), viaTypedef: false, topConst };
    }

    const bare = stripConst(t);
    if (bare === "void") return { kind: "void" };
    if (bare in SCALARS) return this.scalar(bare);
    if (bare === "instancetype" || bare === "id" || /^id\s*<.*>$/.test(bare)) return { kind: "object", class: null };
    if (bare === "Class" || /^Class\s*<.*>$/.test(bare)) return { kind: "class" };
    if (bare === "SEL") return { kind: "sel" };
    // `NSString`, `NSArray<NSString *>`, `NSObject<NSCopying>` (the pointee of an object pointer).
    const generic = /^([A-Za-z_]\w*)\s*<.*>$/.exec(bare);
    const name = generic ? generic[1] : bare;
    if (/^[A-Za-z_]\w*$/.test(name)) {
      if (this.ast.interfaces.has(name)) return { kind: "object", class: name };
      if (this.bridged && this.ast.objectTypedefs.has(name)) return { kind: "object", class: null };
      const def = this.ast.typedefs.get(name);
      if (def) {
        const expanded = this.resolve(def.sugar, depth + 1);
        // Through a typedef a pointer remembers it was spelled as one (`CFStringRef`, `NSRectArray`).
        if (expanded.kind === "pointer") return { ...expanded, viaTypedef: true, topConst: /\bconst\b/.test(t) };
        if (expanded.kind === "unknown" && def.canon !== def.sugar) return this.resolve(def.canon, depth + 1);
        return expanded;
      }
      const enumType = this.ast.enums.get(name);
      if (enumType) return this.resolve(enumType.canon, depth + 1);
      const struct = this.ast.structs.get(name);
      if (struct) return { kind: "struct", struct, tag: struct.tag, union: struct.kind === "union" };
    }
    const tagged = /^(struct|union) ([A-Za-z_]\w*)$/.exec(bare);
    if (tagged) {
      const struct = this.ast.structs.get(bare) ?? null;
      return { kind: "struct", struct, tag: struct ? struct.tag : tagged[2], union: tagged[1] === "union" };
    }
    const enumTag = /^enum ([A-Za-z_]\w*)$/.exec(bare);
    if (enumTag) {
      const enumType = this.ast.enums.get(enumTag[1]);
      return enumType ? this.resolve(enumType.canon, depth + 1) : this.scalar("int");
    }
    // `struct X::(anonymous at file:line:col)`, `union (unnamed at …)`
    const anonymous = /\((?:anonymous|unnamed)(?: (struct|union))? at ([^()]+):(\d+):(\d+)\)$/.exec(bare);
    if (anonymous) {
      const struct = this.ast.structs.get(`@${anonymous[2]}:${anonymous[3]}:${anonymous[4]}`) ?? null;
      return { kind: "struct", struct, tag: null, union: (anonymous[1] ?? bare.split(" ")[0]) === "union" };
    }
    if (/^(struct|union) /.test(bare))
      return { kind: "struct", struct: null, tag: null, union: bare.startsWith("union") };
    return { kind: "unknown", text: printed };
  }

  /** `^ _Nullable *`-style trailing stars after a block/function declarator: pointers to it. */
  private wrapPointers(inner: Resolved, stars: string): Resolved {
    let out = inner;
    for (const c of stars)
      if (c === "*") out = { kind: "pointer", to: out, const: false, viaTypedef: false, topConst: false };
    return out;
  }

  /** Whether `pointee *` is an Objective-C object (`NSString *`, `__kindof NSView *`, a typedef of a class type) rather than a pointer to something (`id *`, `NSImageName *`, `unichar *`). */
  private isObjectType(pointee: string): boolean {
    const bare = stripConst(pointee);
    if (bare.endsWith("*")) return false;
    const name = /^([A-Za-z_]\w*)\b/.exec(bare)?.[1] ?? "";
    if (name === "id" || name === "instancetype" || name === "Class") return false;
    if (this.ast.interfaces.has(name)) return true;
    const def = this.ast.typedefs.get(name);
    return (
      def !== undefined &&
      this.isObjectType(def.sugar.replace(/\b(_Nonnull|_Nullable|_Null_unspecified|__kindof)\b/g, " "))
    );
  }

  /** Whether `r` encodes whole: no piece clang leaves empty (a SIMD vector) or that these headers do not define. */
  encodable(r: Resolved): boolean {
    switch (r.kind) {
      case "scalar":
        return r.enc !== "";
      case "unknown":
      case "function":
        return false;
      case "pointer":
        return r.to.kind === "function" || r.to.kind === "void" || this.encodable(r.to);
      case "array":
        return this.encodable(r.of);
      case "struct":
        return (
          !r.struct || !r.struct.complete || r.struct.fields.every(f => this.encodable(this.resolve(f.type.sugar)))
        );
      case "block":
        return [r.returns, ...r.params].every(x => this.encodable(x));
      default:
        return true;
    }
  }

  /**
   * Whether the bridge lays a struct of this type out (`StructType::parse`
   * in src/appkit/objc/dynamic.rs): defined, not a union, not empty, at
   * most 128 bytes, and every member a scalar it converts or such a struct.
   */
  structCrosses(r: Resolved & { kind: "struct" }): boolean {
    const s = r.struct;
    if (r.union || !s || !s.complete || s.fields.length === 0 || this.sizeOf(r) > 128) return false;
    return s.fields.every(f => {
      if (f.bits !== null) return false;
      const fr = this.resolve(f.type.sugar);
      return fr.kind === "scalar" ? BRIDGE_SCALARS.test(fr.enc) : fr.kind === "struct" && this.structCrosses(fr);
    });
  }

  /**
   * Whether the bridge converts a value of type `r` given its encoding
   * (`Enc::parse` in src/appkit/objc/dynamic.rs reads it as something
   * other than `Enc::Other`): the scalars it knows, objects, classes,
   * selectors, blocks, a pointer to anything, and the structs it lays out.
   */
  converts(r: Resolved): boolean {
    switch (r.kind) {
      case "void":
      case "object":
      case "class":
      case "sel":
      case "block":
      case "pointer":
        return this.encodable(r);
      case "scalar":
        return BRIDGE_SCALARS.test(r.enc);
      case "struct":
        return this.encodable(r) && this.structCrosses(r);
      case "array":
      case "function":
      case "unknown":
        return false;
    }
  }

  /** sizeof, or 0 for what has no size here (void, an incomplete struct, a function). */
  sizeOf(r: Resolved): number {
    return this.layout(r).size;
  }

  layout(r: Resolved): { size: number; align: number } {
    switch (r.kind) {
      case "scalar":
        return { size: r.size, align: r.align };
      case "void":
      case "function":
      case "unknown":
        return { size: 0, align: 1 };
      case "object":
      case "class":
      case "sel":
      case "block":
      case "pointer":
        return { size: 8, align: 8 };
      case "array": {
        const e = this.layout(r.of);
        return { size: e.size * (r.count ?? 0), align: e.align };
      }
      case "struct": {
        const s = r.struct;
        if (!s || !s.complete) return { size: 0, align: 1 };
        const cap = (a: number) => (s.packed ? 1 : s.maxAlign ? Math.min(a, s.maxAlign) : a);
        const roundUp = (n: number, to: number) => Math.ceil(n / to) * to;
        let bits = 0;
        let align = 1;
        for (const f of s.fields) {
          const fl = this.layout(this.resolve(f.type.sugar));
          const a = cap(fl.align);
          if (s.kind === "union") {
            bits = Math.max(bits, fl.size * 8);
            align = Math.max(align, a);
            continue;
          }
          if (f.bits !== null) {
            // A bit-field goes where the last one ended if it still fits a
            // storage unit of its own type there, else at the next unit.
            if (f.bits === 0) {
              bits = roundUp(bits, a * 8);
              continue;
            }
            const unit = a * 8;
            const unitStart = Math.floor(bits / unit) * unit;
            if (bits - unitStart + f.bits > fl.size * 8) bits = roundUp(bits, unit);
            bits += f.bits;
            align = Math.max(align, a);
            continue;
          }
          bits = (roundUp(Math.ceil(bits / 8), a) + fl.size) * 8;
          align = Math.max(align, a);
        }
        return { size: roundUp(Math.ceil(bits / 8), align), align };
      }
    }
  }

  /**
   * The type encoding clang gives `r` as a method's parameter or result
   * (`@encode` at the outermost level: pointed-to structs expanded once,
   * `r` for a pointer to const), or as a struct member below that.
   */
  encode(r: Resolved, level: "outermost" | "pointee" | "nested" | "field" = "outermost"): string {
    switch (r.kind) {
      case "void":
        return "v";
      case "scalar":
        return r.enc;
      case "object":
        return "@";
      case "class":
        return "#";
      case "sel":
        return ":";
      case "block":
        return "@?";
      case "function":
        return "?";
      case "unknown":
        return "?";
      case "array":
        return `[${r.count ?? 0}${this.encode(r.of, level === "outermost" ? "field" : level)}]`;
      case "pointer": {
        // `r` for a pointer to const, judged the way clang does: by the
        // innermost pointee, unless the pointer was written as a typedef
        // name, when only a `const` on that name counts.
        const out = level === "outermost" && pointsToConst(r) ? "r" : "";
        const to = r.to;
        // `char *` (signed or unsigned) is a C string. `BOOL *` on x86_64 (where
        // BOOL is a signed char) stays `^c`, a pointer to one BOOL, which is
        // what clang means it to be and what the bridge reads it as.
        if (to.kind === "scalar" && to.size === 1 && to.integral && !/^(BOOL|bool|_Bool)$/.test(to.name))
          return out + "*";
        // The struct an outermost pointer points to is spelled out; below that it is only named.
        return out + "^" + this.encode(to, level === "outermost" ? "pointee" : "nested");
      }
      case "struct": {
        const [open, close] = r.union ? ["(", ")"] : ["{", "}"];
        const name = r.tag ?? "?";
        // Written with its `=` (`^^{__CFError=}`): NSMethodSignature keeps a
        // nested struct's name only in that form.
        if (level === "nested") return this.written ? `${open}${name}=${close}` : `${open}${name}${close}`;
        if (!r.struct || !r.struct.complete) return `${open}${name}=${close}`;
        const fields = r.struct.fields
          .map(f => {
            const fr = this.resolve(f.type.sugar);
            return f.bits !== null ? `b${f.bits}` : this.encode(fr, "field");
          })
          .join("");
        return `${open}${name}=${fields}${close}`;
      }
    }
  }

  /** The size a value of `r` takes in a method's argument frame, as clang counts it for the offsets in a method type encoding. */
  frameSize(r: Resolved): number {
    if (r.kind === "array") return 8;
    const size = this.sizeOf(r);
    if (r.kind === "scalar" && r.integral) return Math.max(size, 4);
    return size;
  }

  /**
   * The method type encoding clang emits for `m` (`v24@0:8@16`): result,
   * frame size, then self, _cmd and each parameter with its offset.
   */
  methodTypes(m: Method): string {
    const params = m.params.map(p => this.paramType(p));
    let offset = 16;
    for (const p of params) offset += this.frameSize(p);
    let out = `${m.returnsQualifiers}${this.encode(this.resolve(m.returns.sugar))}${offset}@0:8`;
    offset = 16;
    m.params.forEach((p, i) => {
      out += `${p.qualifiers}${this.encode(params[i])}${offset}`;
      offset += this.frameSize(params[i]);
    });
    return out;
  }

  /** A parameter's type, with an array of known length (`NSRect[4]`, `uuid_t`) kept as clang keeps it rather than as the pointer the dump prints. */
  paramType(p: Param): Resolved {
    const declared = this.resolve(p.type.sugar);
    if (declared.kind !== "pointer" || p.written === null) return declared;
    const fixed = /\[[^\]\d]*(\d+)\s*\]\s*$/.exec(p.written);
    if (fixed) return { kind: "array", of: declared.to, count: Number(fixed[1]) };
    // `const uuid_t _Nullable`: a typedef of an array.
    const name = p.written
      .replace(
        /\b(const|in|out|inout|bycopy|byref|oneway|_Nonnull|_Nullable|_Null_unspecified|__unsafe_unretained|__strong|__autoreleasing)\b/g,
        " ",
      )
      .replace(/__attribute__\(\(.*?\)\)/g, " ")
      .trim();
    if (/^[A-Za-z_]\w*$/.test(name) && this.ast.typedefs.has(name)) {
      const aliased = this.resolve(name);
      if (aliased.kind === "array" && aliased.count !== null) return aliased;
    }
    return declared;
  }
}

const stripConst = (t: string) =>
  t
    .replace(/\bconst\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether an outermost pointer encodes with `r`: its innermost pointee is const or, written as a typedef name, that name is const-qualified. */
export function pointsToConst(r: Resolved & { kind: "pointer" }): boolean {
  return r.viaTypedef ? r.topConst : innermostConst(r);
}

/** Whether the innermost pointee of a pointer chain is const. */
function innermostConst(r: Resolved): boolean {
  let p: Resolved = r;
  let last = false;
  while (p.kind === "pointer") {
    last = p.const;
    p = p.to;
  }
  return last;
}

/** Whether `pointee` (the text left of a `*`) is const-qualified at its own level: `const char`, `char const`, `NSString *const` (a const pointer, when the pointee is itself a pointer); a typedef of a const type counts. */
function isConstQualified(pointee: string, types: Types): boolean {
  const t = pointee.trim();
  if (t.endsWith("*")) return false;
  if (/\*\s*const$/.test(t)) return true;
  if (/\bconst\b/.test(t.replace(/<.*>/, ""))) return true;
  const name = /^([A-Za-z_]\w*)$/.exec(t)?.[1];
  const def = name ? types.ast.typedefs.get(name) : undefined;
  return def !== undefined && !def.sugar.trim().endsWith("*") && /^const\b/.test(def.sugar.trim());
}

/**
 * Splits `Ret (^ _Nullable)(A, B)` / `Ret (*)(A)` / `Ret (A, B)` into its
 * parts; null for a type that is not function-like. `declarator` is the
 * text inside the `(^…)`/`(*…)` group, or null for a bare function type.
 */
function splitDeclarator(t: string): { returns: string; declarator: string | null; params: string } | null {
  if (!t.endsWith(")")) return null;
  // The parameter list is the last top-level group.
  let depth = 0;
  let open = -1;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ")") depth++;
    else if (t[i] === "(") {
      depth--;
      if (depth === 0) {
        open = i;
        break;
      }
    }
  }
  if (open <= 0) return null;
  const params = t.slice(open + 1, -1);
  const head = t.slice(0, open).trim();
  // `Ret (^ _Nullable)` / `Ret (*)` / `Ret (*const)`: a declarator group ends the head.
  if (head.endsWith(")")) {
    let d = 0;
    let start = -1;
    for (let i = head.length - 1; i >= 0; i--) {
      if (head[i] === ")") d++;
      else if (head[i] === "(") {
        d--;
        if (d === 0) {
          start = i;
          break;
        }
      }
    }
    if (start < 0) return null;
    const declarator = head.slice(start + 1, -1).trim();
    if (declarator.startsWith("^") || declarator.startsWith("*")) {
      return { returns: head.slice(0, start).trim(), declarator, params };
    }
    return null;
  }
  // A bare function type `NSComparisonResult (id, id, void *)`: the head is a type with no unbalanced parens.
  if (/^[\w\s*<>,:]+$/.test(head) && !/^(struct|union|enum)$/.test(head))
    return { returns: head, declarator: null, params };
  return null;
}

/** Splits `A, B (^)(C, D), E` at the top-level commas; `void` alone is no parameters. */
export function splitParams(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(" || c === "<" || c === "[") depth++;
    else if (c === ")" || c === ">" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out.map(s => s.trim()).filter(s => s !== "" && s !== "void" && s !== "...");
}
