#!/usr/bin/env bun
// The NS_ENUM / NS_OPTIONS constants of the frameworks the `objc` bridge in
// bun:objc loads (Foundation, AppKit, QuartzCore, Metal, MetalKit), by name.
//
// The Objective-C runtime knows nothing about enums, so the bridge carries a
// table of them (`objc.enums.NSWindowStyleMask.titled`). This reads the
// SDK (scripts/appkit-sdk.ts: one translation unit per architecture, parsed
// once) for every enum declared in one of those frameworks' headers, the C
// type of every exported non-object constant those headers pull in
// (CoreFoundation, CoreGraphics and the C library included, since
// `objc.constants` reaches every exported symbol and reads one as an object
// unless this table says otherwise), the type encoding of every C function
// Foundation, AppKit, CoreGraphics and CoreFoundation export whose types the
// bridge converts (`objc.functions`), and writes appkit_enums.ts.
// It also writes cf.rs: every Core Foundation style type those
// headers pull in (`CGColorRef`, `CFStringRef`, `CTFontRef`, `SecKeyRef`)
// with its `…GetTypeID` function and the class it is toll-free bridged to,
// so the bridge passes them as the objects they are. The build runs this
// (through scripts/appkit-generate.ts --out) against the SDK it links and
// writes both files into its codegen directory; their first lines name that
// SDK's version.
//
//   bun scripts/appkit-enums.ts <out dir>   # write the tables there

import { join } from "node:path";
import {
  type Arch,
  type Ast,
  astLines,
  BRIDGED,
  type CType,
  inFramework,
  readSdk,
  stamped,
  translationUnit,
  Types,
  typesIn,
} from "./appkit-sdk";

type Member = { name: string; value: bigint; deprecated: boolean };
type Enum = { name: string | null; file: string; members: Member[] };
/** A `static const` number: its literal, or the enum member it copies. */
type Static = { negative: boolean; literal: string | null; alias: string | null; valid: boolean };
/** A struct that `…Ref` typedefs with a `…GetTypeID()` point at: the struct its encoding names, those functions (the typedef named like the struct first: `CFBundleRef` and `CFPlugInRef` are both `struct __CFBundle *`), and the class it is toll-free bridged to (`""` for none, or `id`). */
export type CFType = { struct: string; typeIDs: string[]; bridged: string };

/** A value that may differ between the two architectures, as JavaScript source for each. */
type ByArch = { arm: string; intel: string };

/** What appkit_enums.ts and cf.rs hold, before printing. */
export type EnumTables = {
  /** Each named enumeration: the prefix its members share (see {@link prefixOf}) and its members with their values. */
  enums: Map<string, { prefix: string; members: { name: string; suffix: string; value: ByArch; big: boolean }[] }>;
  /** Members of unnamed enums and `static const` numbers; `big` when the value is a bigint literal. */
  loose: Map<string, ByArch & { big: boolean }>;
  /** The type encoding of each exported constant that is a number or a struct. */
  constants: Map<string, ByArch>;
  /** The type encodings (result, then each argument) of each exported C function the bridge converts, and its format argument's index when it takes `...`. */
  functions: Map<string, ByArch & { format: number | null }>;
  cfTypes: Map<string, CFType>;
};

/** Whose exported functions `objc.functions` lists (the umbrella headers' own, and CoreFoundation's, which Foundation's brings; NSDebug.h is read for its constants only). */
const FUNCTION_FRAMEWORKS = ["Foundation", "AppKit", "CoreGraphics", "CoreFoundation"];
const exportsFunctions = (file: string) => inFramework(file, FUNCTION_FRAMEWORKS) && !file.endsWith("/NSDebug.h");
/**
 * Functions that retain, release, allocate or deallocate an object
 * (`CGColorRelease`, `CGPathRetain`, `NSDeallocateObject`): a handle owns its
 * reference and gives it back itself, so these would unbalance it. The
 * bridge refuses them by this same rule (a `…Retain`/`…Release` of one
 * object or pointer; `CGDisplayRelease` takes a display number and stays);
 * leaving them out keeps the typings from offering them.
 */
const managesReferences = (name: string, argTypes: string[]) =>
  (/(Retain|Release|Autorelease)$/.test(name) && argTypes.length === 1 && /^r?[@^]/.test(argTypes[0])) ||
  /^NS(Allocate|Deallocate)Object$|^NS(Increment|Decrement)ExtraRefCount/.test(name);
const VA_LIST = /\bva_list\b|__va_list_tag/;

/** A value as JavaScript source: a number when that is exact, else a bigint. */
const literal = (v: bigint) => (v > 9007199254740992n || v < -9007199254740992n ? `${v}n` : `${v}`);

// ────────────────────────── enumerators and constants ───────────────────────

type Declared = {
  enums: Enum[];
  statics: Map<string, Static>;
  /** Every `extern` variable, with its type. */
  externs: Map<string, CType & { bridged: boolean }>;
};

/**
 * The enumerators, `static const` numbers and `extern` variables of one
 * architecture's translation unit: what scripts/appkit-sdk.ts `parse()`
 * does not model, because only this table wants member values and
 * initializers.
 */
function declared(arch: Arch): Declared {
  const enums: Enum[] = [];
  const statics = new Map<string, Static>();
  const externs = new Map<string, CType & { bridged: boolean }>();
  let staticVar: ({ depth: number; name: string } & Static) | null = null;
  let current: { depth: number; item: Enum; pending: Member | null; hasInit: boolean } | null = null;

  const finishMember = () => {
    if (!current?.pending) return;
    const members = current.item.members;
    if (!current.hasInit) {
      current.pending.value = members.length === 0 ? 0n : members[members.length - 1].value + 1n;
    }
    members.push(current.pending);
    current.pending = null;
  };
  const finishEnum = () => {
    if (!current) return;
    finishMember();
    if (current.item.members.length > 0) enums.push(current.item);
    current = null;
  };

  for (const { line, depth, body, kind, begin, end } of astLines(translationUnit(arch).ast)) {
    if (depth === 0) continue;
    if (current && depth <= current.depth) finishEnum();
    if (current && depth === current.depth + 1) finishMember();
    if (staticVar && depth <= staticVar.depth) {
      if (staticVar.valid && (staticVar.literal !== null || staticVar.alias !== null)) {
        statics.set(staticVar.name, staticVar);
      }
      staticVar = null;
    }
    if (staticVar) {
      // `static const NSModalResponse NSModalResponseOK = 1`: a literal,
      // maybe negated, or the name of an enum member.
      let m: RegExpMatchArray | null;
      if (/^UnaryOperator .* prefix '-'$/.test(body)) staticVar.negative = !staticVar.negative;
      else if ((m = body.match(/^IntegerLiteral .* (-?\d+)$/))) staticVar.literal ??= literal(BigInt(m[1]));
      else if ((m = body.match(/^FloatingLiteral .* ([-+.0-9eE]+)$/))) staticVar.literal ??= String(Number(m[1]));
      else if ((m = body.match(/^DeclRefExpr .* EnumConstant 0x[0-9a-f]+ '(\w+)'/))) staticVar.alias ??= m[1];
      else if (
        /^[A-Za-z]*(Operator|Expr|Literal)$/.test(kind) &&
        !/^(ImplicitCastExpr|ParenExpr|ConstantExpr)$/.test(kind)
      ) {
        staticVar.valid = false; // arithmetic or a call: not a plain constant
      }
      continue;
    }
    const file = (end && end.file.startsWith("/") ? end.file : begin?.file) ?? "";

    if (kind === "EnumDecl") {
      finishEnum();
      // `... col:32 NSWindowStyleMask 'NSUInteger':'unsigned long'` or, unnamed, `... col:1 'NSUInteger':...`
      const named = / ([A-Za-z_][A-Za-z0-9_]*) '/.exec(body);
      const name = named && !/^(col|line)$/.test(named[1]) ? named[1] : null;
      if (!inFramework(file, BRIDGED)) continue;
      current = { depth, item: { name, file, members: [] }, pending: null, hasInit: false };
      continue;
    }
    if (!current) {
      if (kind === "VarDecl" && body.endsWith(" extern")) {
        // `NSFontWeightBold 'const NSFontWeight':'const double' extern`
        const m = / ([A-Za-z_][A-Za-z0-9_]*) ('.*') extern$/.exec(body);
        const type = m ? typesIn(m[2]) : null;
        if (m && type) externs.set(m[1], { ...type, bridged: inFramework(file, BRIDGED) });
      } else if (kind === "VarDecl" && body.endsWith(" static cinit") && inFramework(file, BRIDGED)) {
        const m = / ([A-Za-z_][A-Za-z0-9_]*) ('.*') static cinit$/.exec(body);
        const type = m ? (typesIn(m[2])?.canon ?? "").replace(/\bconst /g, "") : "";
        if (m && (/^enum \w+$/.test(type) || /^[a-z ]+$/.test(type))) {
          staticVar = { depth, name: m[1], negative: false, literal: null, alias: null, valid: true };
        }
      }
      continue;
    }
    if (depth === current.depth + 1) {
      if (kind === "EnumConstantDecl") {
        const m = / ([A-Za-z_][A-Za-z0-9_]*) '/.exec(body);
        if (!m) throw new Error(`cannot read the enumerator in: ${line}`);
        current.pending = { name: m[1], value: 0n, deprecated: false };
        current.hasInit = false;
      }
      continue;
    }
    if (!current.pending) continue;
    // Inside an EnumConstantDecl: its evaluated initializer and its availability.
    const value = /^value: Int (-?\d+)$/.exec(body);
    if (value && !current.hasInit) {
      current.pending.value = BigInt(value[1]);
      current.hasInit = true;
      continue;
    }
    const availability = /^AvailabilityAttr .*?\bmacos ([0-9._]+) ([0-9._]+) ([0-9._]+)/.exec(body);
    if (availability && availability[2] !== "0") current.pending.deprecated = true;
    if (kind === "DeprecatedAttr") current.pending.deprecated = true;
  }
  finishEnum();
  return { enums, statics, externs };
}

// ─────────────────────────── functions and CF types ─────────────────────────

/**
 * The type encodings (result, then each argument) of every C function the
 * frameworks in {@link FUNCTION_FRAMEWORKS} export whose every type the
 * bridge converts, and the index of its format argument when it takes
 * `...` after an NSString format; functions reading a `va_list`, other
 * variadics, and the reference-managing ones are left out.
 */
function functionsOf(ast: Ast): Map<string, { types: string; format: number | null }> {
  // Written as a script writes an encoding: `B` for BOOL on both architectures.
  const types = new Types(ast, true, true);
  const out = new Map<string, { types: string; format: number | null }>();
  for (const [name, f] of ast.functions) {
    if (!f.exported || name.startsWith("_") || !exportsFunctions(f.file)) continue;
    // `NS_FORMAT_FUNCTION(F, A)`: A is where `...` starts, 0 for the variant that takes a `va_list` instead.
    const nsFormat = f.format?.kind === "NSString" ? f.format : null;
    if (nsFormat?.first === 0 || f.params.some(p => VA_LIST.test(p.type.sugar) || VA_LIST.test(p.type.canon))) continue;
    const format = nsFormat ? nsFormat.format - 1 : null;
    if (f.variadic && format === null) continue;
    const resolved = [f.returns, ...f.params.map(p => p.type)].map(t => types.resolve(t.sugar));
    if (!resolved.every(r => types.converts(r))) continue;
    const encodings = resolved.map(r => types.encode(r));
    if (managesReferences(name, encodings.slice(1))) continue;
    // A format's values are objects; one whose format is a C string (NSLog's is not) takes C values.
    if (format !== null && encodings[format + 1] !== "@") continue;
    out.set(name, { types: encodings.join(""), format });
  }
  return out;
}

/**
 * The type encoding of each `extern` constant that is a number or a struct
 * the bridge converts. An object (or any pointer, which may be one: a
 * `CFStringRef`) needs no entry. A struct or array held by value that the
 * bridge cannot convert (a table of function pointers) in one of the
 * bridged frameworks is recorded as `?`: read as an object its first word
 * could pass for one, so the bridge refuses instead of guessing. Elsewhere
 * the runtime check stands alone; those tables are many and rarely named.
 */
function constantsOf(ast: Ast, externs: Map<string, CType & { bridged: boolean }>): Map<string, string> {
  const types = new Types(ast, true, true);
  const out = new Map<string, string>();
  for (const [name, type] of externs) {
    const r = types.resolve(type.sugar);
    if ((r.kind === "scalar" || r.kind === "struct") && types.converts(r)) out.set(name, types.encode(r));
    else if (type.bridged && (r.kind === "struct" || r.kind === "array")) out.set(name, "?");
  }
  return out;
}

/** Every struct a `…Ref` typedef with an exported `CFTypeID …GetTypeID(void)` points at, keyed by struct name. */
function cfTypes(ast: Ast): Map<string, CFType> {
  const out = new Map<string, CFType>();
  for (const [typedef, type] of ast.typedefs) {
    const ref = /^(\w+)Ref$/.exec(typedef);
    const struct = /^(?:const )?struct (\w+) \*$/.exec(type.canon);
    if (!ref || !struct) continue;
    const typeID = `${ref[1]}GetTypeID`;
    const fn = ast.functions.get(typeID);
    if (!fn || !fn.exported || fn.returns.sugar !== "CFTypeID" || fn.params.length > 0 || fn.variadic) continue;
    const bridged = ast.structs.get(`struct ${struct[1]}`)?.bridged ?? "";
    const row = out.get(struct[1]) ?? { struct: struct[1], typeIDs: [], bridged: bridged === "id" ? "" : bridged };
    // Several typedefs of one struct: the one spelled like the struct decides first.
    if (struct[1].replace(/^_+/, "") === ref[1]) row.typeIDs.unshift(typeID);
    else row.typeIDs.push(typeID);
    out.set(struct[1], row);
  }
  return out;
}

// ───────────────────────────── member names ─────────────────────────────────

/** `NSURLBookmarkCreationOptions` -> ["NSURL", "Bookmark", "Creation", "Options"]: runs of capitals stay together up to the one that starts the next word. */
function words(name: string): string[] {
  return name.match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+|_+/g) ?? [name];
}

const singular = (w: string) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.replace(/e?s$/, ""));
const sameWord = (a: string, b: string) => a === b || singular(a) === singular(b);

/** Whether what `prefix` leaves of every name starts a new word (a capital). */
const leavesWords = (prefix: string, names: string[]) =>
  names.every(n => !n.startsWith(prefix) || /^[A-Z]/.test(n.slice(prefix.length)));

/**
 * The prefix every member of an enum drops for its short name: the text the
 * (non-deprecated) members share, cut back to where a word starts in each of
 * them, then to the words it also shares with the type name (plurals count:
 * `…Options` matches `…Option…`; a leading `k` is kept in the prefix). A lone
 * member shares all but its last word.
 */
function prefixOf(typeName: string, members: Member[]): string {
  const live = members.filter(m => !m.deprecated);
  const names = (live.length > 0 ? live : members).map(m => m.name);
  let prefix = names[0];
  if (names.length === 1) {
    prefix = prefix.slice(0, prefix.length - (words(prefix).at(-1)?.length ?? 0));
  } else {
    for (const n of names) {
      let i = 0;
      while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
      prefix = prefix.slice(0, i);
    }
  }
  while (prefix && !leavesWords(prefix, names)) prefix = prefix.slice(0, -1);
  const prefixWords = words(prefix);
  const typeWords = words(typeName);
  // CoreFoundation-style members carry a `k` the type name does not (`kCALayerLeftEdge` in `CAEdgeAntialiasingMask`).
  let shared = prefixWords[0] === "k" && typeWords[0] !== "k" ? 1 : 0;
  const skipped = shared;
  for (
    let i = 0;
    i + skipped < prefixWords.length && i < typeWords.length && sameWord(prefixWords[i + skipped], typeWords[i]);
    i++
  ) {
    shared += prefixWords[i + skipped].length;
  }
  return shared === skipped ? "" : prefix.slice(0, shared);
}

// ─────────────────────────────── tables ─────────────────────────────────────

let scanned: EnumTables | undefined;

/** Everything both outputs hold, read from both architectures' SDK slices (once). */
export function enumTables(): EnumTables {
  if (scanned) return scanned;
  const [armAst, intelAst] = [readSdk("arm64"), readSdk("x86_64")];
  const [arm, intel] = [declared("arm64"), declared("x86_64")];

  // Values by member name per architecture; the two SDK slices declare the
  // same names and differ in a handful of values.
  const intelValues = new Map<string, bigint>();
  for (const e of intel.enums) for (const m of e.members) intelValues.set(m.name, m.value);
  const armValues = new Map<string, bigint>();
  for (const e of arm.enums) for (const m of e.members) armValues.set(m.name, m.value);
  const value = (m: Member): ByArch & { big: boolean } => {
    const other = intelValues.get(m.name);
    if (other === undefined) throw new Error(`${m.name} is not declared for x86_64`);
    return { arm: literal(m.value), intel: literal(other), big: literal(m.value).endsWith("n") };
  };

  const named = new Map<string, Enum>();
  const loose: EnumTables["loose"] = new Map();
  const flat = new Map<string, string>();
  for (const e of arm.enums) {
    for (const m of e.members) {
      if (flat.has(m.name))
        throw new Error(`${m.name} is declared twice (${flat.get(m.name)} and ${e.name ?? e.file})`);
      flat.set(m.name, e.name ?? e.file);
    }
    if (e.name === null) {
      for (const m of e.members) loose.set(m.name, value(m));
    } else if (named.has(e.name)) {
      named.get(e.name)!.members.push(...e.members);
    } else {
      named.set(e.name, { ...e, members: [...e.members] });
    }
  }
  for (const name of named.keys()) {
    if (flat.has(name)) throw new Error(`${name} is both an enum and a member of ${flat.get(name)}`);
  }
  const staticValue = (s: Static, values: Map<string, bigint>): string | null => {
    const text = s.alias !== null ? (values.has(s.alias) ? literal(values.get(s.alias)!) : null) : s.literal;
    return text === null ? null : s.negative ? `-${text}` : text;
  };
  for (const [name, s] of arm.statics) {
    if (flat.has(name) || named.has(name)) continue;
    const a = staticValue(s, armValues);
    const other = intel.statics.get(name);
    const b = other ? staticValue(other, intelValues) : null;
    if (a === null || b === null) continue;
    loose.set(name, { arm: a, intel: b, big: a.endsWith("n") });
  }

  const enums: EnumTables["enums"] = new Map();
  for (const e of [...named.values()].sort((a, b) => (a.name! < b.name! ? -1 : 1))) {
    const prefix = prefixOf(e.name!, e.members);
    enums.set(e.name!, {
      prefix,
      members: e.members.map(m => {
        const { arm, intel, big } = value(m);
        const suffix = prefix && m.name.startsWith(prefix) ? m.name.slice(prefix.length) : "=" + m.name;
        return { name: m.name, suffix, value: { arm, intel }, big };
      }),
    });
  }

  const constants: EnumTables["constants"] = new Map();
  const intelConstants = constantsOf(intelAst, intel.externs);
  for (const [name, encoding] of [...constantsOf(armAst, arm.externs)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const other = intelConstants.get(name);
    if (other !== undefined) constants.set(name, { arm: encoding, intel: other });
  }

  const functions: EnumTables["functions"] = new Map();
  const intelFunctions = functionsOf(intelAst);
  for (const [name, f] of [...functionsOf(armAst)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const other = intelFunctions.get(name);
    if (other === undefined || other.format !== f.format) continue;
    // `BOOL` (`B`, `c`) and `boolean_t` (`i`, `I`) differ between the two.
    functions.set(name, { arm: f.types, intel: other.types, format: f.format });
  }

  const armTypes = cfTypes(armAst);
  const intelTypes = cfTypes(intelAst);
  const cf = new Map(
    [...armTypes].filter(([struct, t]) => intelTypes.get(struct)?.typeIDs.join() === t.typeIDs.join()),
  );

  return (scanned = { enums, loose, constants, functions, cfTypes: cf });
}

/** `x` when both architectures agree, else `A ? arm : intel`. */
const byArch = (v: ByArch, quote = (s: string) => s) =>
  v.arm === v.intel ? quote(v.arm) : `A ? ${quote(v.arm)} : ${quote(v.intel)}`;

/** appkit_enums.ts: the enum, constant and function tables bun:objc reads. */
function enumsSource(t: EnumTables): string {
  const lines: string[] = [];
  lines.push("// Generated by scripts/appkit-enums.ts from the macOS SDK's Foundation, AppKit, QuartzCore,");
  lines.push("// Metal and MetalKit headers at build time; do not edit.");
  lines.push("//");
  lines.push("// enums: type name -> [prefix, suffix, value, suffix, value, ...]. A member's full name is");
  lines.push('// prefix + suffix, or the suffix alone after a leading "=" (a member outside the pattern);');
  lines.push("// its short name is the suffix with the first word in lower case.");
  lines.push("// loose: members of unnamed enums and `static const` numbers. constants: the type encoding");
  lines.push("// of each exported constant those headers see that is not an object. functions: the type");
  lines.push("// encoding (return type, then each argument) of each C function Foundation, AppKit,");
  lines.push("// CoreGraphics and CoreFoundation export, with the index of its format argument when it");
  lines.push("// takes `...`.");
  lines.push('const A = process.arch === "arm64";');
  lines.push("// prettier-ignore");
  lines.push("const enums: Record<string, (string | number | bigint)[]> = {");
  for (const [name, e] of t.enums) {
    const parts = [JSON.stringify(e.prefix)];
    for (const m of e.members) parts.push(JSON.stringify(m.suffix), byArch(m.value));
    lines.push(`  ${name}: [${parts.join(",")}],`);
  }
  lines.push("};");
  lines.push("// prettier-ignore");
  lines.push("const loose: Record<string, number | bigint> = {");
  for (const [name, v] of [...t.loose].sort((a, b) => (a[0] < b[0] ? -1 : 1))) lines.push(`  ${name}: ${byArch(v)},`);
  lines.push("};");
  lines.push("// prettier-ignore");
  lines.push("const constants: Record<string, string> = {");
  for (const [name, v] of t.constants) lines.push(`  ${name}: ${byArch(v, s => JSON.stringify(s))},`);
  lines.push("};");
  lines.push("// prettier-ignore");
  lines.push("const functions: Record<string, string | [string, number]> = {");
  for (const [name, f] of t.functions) {
    const text = (types: string) =>
      f.format === null ? JSON.stringify(types) : `[${JSON.stringify(types)}, ${f.format}]`;
    lines.push(`  ${name}: ${byArch(f, text)},`);
  }
  lines.push("};");
  lines.push("export default { enums, loose, constants, functions };");
  lines.push("");
  console.error(
    `${t.enums.size} enums with ${[...t.enums.values()].reduce((n, e) => n + e.members.length, 0)} members, ` +
      `${t.loose.size} loose constants, ${t.constants.size} typed constants, ${t.functions.size} functions, ${t.cfTypes.size} CF types`,
  );
  return lines.join("\n");
}

/** cf.rs: the `CF_TYPES` table, sorted by struct name. */
function cfSource(types: Map<string, CFType>): string {
  const rows = [...types.values()].sort((a, b) => (a.struct < b.struct ? -1 : a.struct > b.struct ? 1 : 0));
  if (
    !rows.some(t => t.struct === "CGColor") ||
    !rows.some(t => t.struct === "__CFString" && t.bridged === "NSString")
  ) {
    throw new Error(`CF types not read from the headers (got ${rows.length})`);
  }
  return `// The Core Foundation style types (\`CGColorRef\`, \`CFStringRef\`,
// \`CTFontRef\`, \`SecCertificateRef\`) the Foundation, AppKit, QuartzCore, Metal
// and MetalKit headers see: objects at run time, told apart by
// \`CFGetTypeID\`. Generated from the SDK headers by scripts/appkit-enums.ts
// at build time; do not edit by hand.

use super::dynamic::CFType;

/// Every struct a \`…Ref\` typedef with a \`…GetTypeID()\` points at: the
/// struct name its type encoding carries (\`^{CGColor=}\`), those functions
/// (several typedefs can share one struct: \`CFBundleRef\` and \`CFPlugInRef\`,
/// \`CVPixelBufferRef\` and \`CVMetalBufferRef\`; an object of any of them is
/// one), and the class it is toll-free bridged to (\`c""\` when it is only
/// ever a Core Foundation object). Sorted by struct name for binary search.
#[rustfmt::skip]
pub(super) static CF_TYPES: [CFType; ${rows.length}] = [
${rows.map(t => `    CFType::new("${t.struct}", &[${t.typeIDs.map(f => `c"${f}"`).join(", ")}], c"${t.bridged}"),\n`).join("")}];
`;
}

/** Write appkit_enums.ts and cf.rs into `outDir`. */
export function main(outDir: string): void {
  const tables = enumTables();
  stamped(join(outDir, "appkit_enums.ts"), enumsSource(tables));
  stamped(join(outDir, "cf.rs"), cfSource(tables.cfTypes));
}

if (import.meta.main) {
  if (!process.argv[2]) throw new Error("usage: bun scripts/appkit-enums.ts <out dir>");
  main(process.argv[2]);
}
