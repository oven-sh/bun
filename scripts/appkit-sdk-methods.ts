#!/usr/bin/env bun
// What the macOS SDK knows about Objective-C methods and protocols that the
// runtime's type encodings and registered metadata do not tell the `objc`
// bridge in bun:objc. Writes sdk.rs (into the build's codegen directory) with its tables, all
// read from the clang AST of one translation unit: the umbrella headers of
// Foundation, AppKit, QuartzCore, Metal and MetalKit, and so every header
// those include (CoreImage, CoreData, ModelIO, Security, …).
//
// - VARIADIC: methods that read a variable argument list (`...` or a
//   `va_list`), which an encoding does not show, and what that list holds
//   (a nil-terminated object list, the arguments of a format string, a
//   `va_list`, or something else).
// - ARRAY_PARAMS: parameters that are C arrays the method indexes (`unichar
//   *buffer` next to a `range:`, `id objects[]` next to a `count:`), which
//   encode exactly like a pointer to one value (`NSError **`), with the
//   argument that gives the element count when one follows (`count:`,
//   `length:`, a `range:` whose length it is).
// - ASSIGN_PROPERTIES: setters of object properties typed `id <SomeProtocol>`
//   and declared `assign` (neither weak, strong, retain nor copy): the
//   delegate-like back-pointers AppKit has not made zeroing-weak, which the
//   bridge has the receiver hold so they cannot dangle.
// - BLOCK_PARAMS: the type encoding of each block parameter (return type,
//   `@?`, each argument), which the runtime encodes as a bare `@?`; the
//   setters of block-typed properties included.
// - PROTOCOLS: every protocol the five frameworks declare, with the protocols
//   it incorporates and its method descriptions encoded as clang emits them
//   (`v24@0:8@16`), so the bridge can register one no loaded framework
//   registers (nothing in them names `@protocol(X)`, which is what makes
//   clang emit it, and which do varies by macOS version).
// - MAIN_THREAD_CLASSES: the AppKit classes whose `@interface` carries
//   NS_SWIFT_UI_ACTOR, AppKit's own statement of what only the main thread
//   may use (their subclasses follow at run time from the class chain).
// - BOOL_PARAMS: parameters declared `BOOL *`, which the x86_64 runtime
//   encodes as a bare `*` (the same as a C string), so the bridge can read
//   them as the out-BOOLs they are there too.
// - OWNERSHIP: methods whose headers state an ownership that their selector
//   does not (NS_RELEASES_ARGUMENT / NS_CONSUMED on a parameter,
//   NS_REPLACES_RECEIVER on the method, NS_RETURNS_RETAINED /
//   NS_RETURNS_NOT_RETAINED on the result, and the CF forms), so both sides
//   of the bridge hand references over the way the compiled caller or
//   callee expects.
// - CHAR_SLOTS: parameters and results declared `char` (or `signed char`),
//   which the x86_64 runtime encodes as `c`, the same as BOOL there, so the
//   bridge can read them as the numbers they are on both architectures.
// - FUNCTION_OWNERSHIP: C functions whose headers state who owns an object
//   result or out-value (CF_RETURNS_RETAINED / CF_RETURNS_NOT_RETAINED and
//   the NS forms, on the function or on an out-parameter), and the
//   `Create`/`Copy` functions whose result is declared as a Core Foundation
//   type the encoding cannot tell from an Objective-C object (`CFTypeRef`,
//   `CFPropertyListRef`, a dispatch object), which Core Foundation's Create
//   Rule makes the caller's.
//
// The one type the two architectures encode differently is BOOL: `B` on
// arm64 and `c` on x86_64 (`BOOL *` is `^B` and `^c`); both are read and a
// row whose encoding differs carries both through `by_arch`. The block
// types are written with `B` on both, the way a script writes them, since
// the bridge reads them as a script's. The tables are as of the SDK named in
// the generated file's first line; rerun this (or scripts/appkit-generate.ts,
// which runs every generator) when the build's SDK pin moves.
//
//   bun scripts/appkit-sdk-methods.ts <out dir>   # write the tables there

import { join } from "node:path";
import {
  type Ast,
  BRIDGED,
  inFramework,
  type Method,
  type Param,
  readSdk,
  type Resolved,
  stamped,
  Types,
} from "./appkit-sdk";

/** Selector parts that give the element count of the array parameter just before them. */
const SIZING = new Set(["count", "length", "maxLength", "maxCount", "numIndices", "capacity", "range"]);
/** Names the SDK gives array parameters that no sizing part follows (the count is implied or elsewhere). */
const ARRAY_NAMES =
  /buf(fer)?$|Array$|^(indexes|indices|glyphs|components|positions|props|vals|charIndexes|points|rects|ranges|locations|pattern)$/i;
const NULLABILITY =
  /\b(_Nonnull|_Nullable_result|_Nullable|_Null_unspecified|__kindof|__unsafe_unretained|__strong|__autoreleasing)\b/g;

export type VariadicRow = { selector: string; class: string; kind: string };
export type ArrayRow = { selector: string; class: string; index: number; counted: string };
export type AssignRow = { selector: string; class: string; assign: boolean };
export type BlockRow = { selector: string; class: string; index: number; types: string };
export type BoolRow = { selector: string; class: string; index: number };
/** `slot` is the argument index, or null for the result. */
export type CharRow = { selector: string; class: string; slot: number | null };
export type FunctionOwnershipRow = { name: string; returnsRetained: boolean | null; retainedOuts: number[] };
export type OwnershipRow = {
  selector: string;
  class: string;
  consumed: number[];
  consumesSelf: boolean;
  returnsRetained: boolean | null;
};
export type ProtocolRow = {
  name: string;
  adopts: string[];
  methods: { selector: string; types: string; required: boolean; instance: boolean }[];
};
export type Tables = {
  variadic: VariadicRow[];
  arrays: ArrayRow[];
  assigns: AssignRow[];
  blocks: BlockRow[];
  protocols: ProtocolRow[];
  mainThreadClasses: string[];
  bools: BoolRow[];
  ownership: OwnershipRow[];
  chars: CharRow[];
  functionOwnership: FunctionOwnershipRow[];
};

const byColumns = (a: (string | number)[], b: (string | number)[]): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};

/**
 * What the variable arguments of a variadic method are, as the bridge passes
 * them: `Objects` for a nil-terminated object list (NS_REQUIRES_NIL_TERMINATION);
 * `Format(i)` when parameter `i` (from 0) is a format string the rest are
 * substituted into (NS_FORMAT_FUNCTION, or a last keyword ending in "Format"
 * as NSPredicate and NSExpression spell it); `VaList` for a `va_list`
 * parameter, which nothing but C can build; `Other` for the rest (values
 * typed by another argument, as `-[NSCoder encodeValuesOfObjCTypes:]`).
 */
function variadicKind(m: Method): string {
  if (m.params.some(takesVaList)) return "VaList";
  // Nil-terminated, but NSColor objects alternating with CGFloat locations.
  if (m.selector === "initWithColorsAndLocations:") return "Other";
  if (m.sentinel) return "Objects";
  const last = m.params.length - 1;
  const format =
    m.format && m.format.first !== 0
      ? m.format.format - 1
      : last >= 0 && /format:$/i.test(m.selector.split(":").filter(Boolean).at(-1) + ":")
        ? last
        : -1;
  if (format < 0 || format > last) return "Other";
  // The bridge scans the format as a string; an NSAttributedString format
  // (`localizedAttributedStringWithFormat:`) or a C one is not one it can read or box.
  if (m.params[format].type.sugar.replace(NULLABILITY, "").replace(/\s+/g, " ").trim() !== "NSString *") return "Other";
  return `Format(${format})`;
}

const takesVaList = (p: Param) => /\bva_list\b|__va_list_tag/.test(p.type.sugar) || /\bva_list\b/.test(p.written ?? "");

/**
 * Whether `param` is declared as a C array the method reads or fills: an
 * array declarator (`ObjectType objects[]`), or a pointer to a value type
 * (`unichar *`, `NSUInteger *`, `char *`, `const CGFloat *`, `NSRectArray`)
 * that a sizing part follows (`count:`, `length:`, `maxLength:`, `range:`,
 * …) or whose name says so (`buffer`, `glyphs`, `components`, `…Array`), or
 * a `void *` that a sizing part follows (`-[NSData getBytes:length:]`).
 * Every other pointer (`NSError **`, `BOOL *isDirectory`, `NSRangePointer
 * effectiveRange`) points at one value. A pointer to a type without a size
 * here (an opaque struct) counts only with a sizing part after it.
 */
function isArrayParam(types: Types, param: Param, keyword: string, nextKeyword: string | undefined): boolean {
  if (param.written !== null && /\[[^\]]*\]\s*$/.test(param.written)) return true;
  const r = types.resolve(param.type.sugar);
  if (r.kind !== "pointer") return false;
  const to = r.to;
  const sized = nextKeyword !== undefined && SIZING.has(nextKeyword);
  switch (to.kind) {
    case "void":
      return sized;
    case "scalar":
      // A SIMD vector has no encoding; like any type unknown here it counts only when sized.
      if (to.enc === "") return sized;
      break;
    case "struct":
      if (!to.struct?.complete) return sized;
      break;
    default:
      return false;
  }
  // `NSRectArray rects`: the typedef's name says array (a `…Pointer` one says one value).
  const spelled = (param.written ?? param.type.sugar)
    .replace(NULLABILITY, " ")
    .replace(/\bconst\b/g, " ")
    .trim();
  const namedArray = /^[A-Za-z_]\w*Array$/.test(spelled);
  return sized || ARRAY_NAMES.test(param.name) || namedArray;
}

/**
 * How the bridge finds an array parameter's element count among the
 * arguments, as the Rust table spells it: the sizing argument after it holds
 * the count (`Count`), or an `NSRange` whose length is the count (`Range`);
 * `None` when no sizing part follows (the count is implied or elsewhere).
 */
function countedBy(types: Types, index: number, nextKeyword: string | undefined, next: Param | undefined): string {
  if (next === undefined || nextKeyword === undefined || !SIZING.has(nextKeyword)) return "None";
  const r = types.resolve(next.type.sugar);
  const range = r.kind === "struct" && r.tag === "_NSRange";
  if (nextKeyword === "range" && !range) return "None";
  return `Some(Counted::${range ? "Range" : "Count"}(${index + 1}))`;
}

/**
 * Functions whose header says nothing about the object they return but
 * which hand the caller a reference, proven by measuring: the NSMapTable
 * twins are declared NS_RETURNS_RETAINED, this one is not. The only rows
 * of FUNCTION_OWNERSHIP that are not a function of the SDK; the table's
 * doc comment names them, and the objc-ergonomics fixture ("function
 * ownership") holds the measurement.
 */
const UNDECLARED_RETAINED = new Set(["NSCopyHashTableWithZone"]);

/** The tables as read from one architecture's AST. */
export function tables(ast: Ast): Tables {
  const types = new Types(ast);
  const written = new Types(ast, false, true);
  const keywordsOf = (m: Method) => m.selector.split(":").slice(0, m.params.length);

  const variadic = new Map<string, VariadicRow>();
  const arrays = new Map<string, ArrayRow>();
  const blocks = new Map<string, BlockRow>();
  const bools = new Map<string, BoolRow>();
  const chars = new Map<string, CharRow>();
  const ownership = new Map<string, OwnershipRow>();
  const conflicts = new Set<string>();
  const isChar = (r: Resolved) => r.kind === "scalar" && /^(signed )?char$/.test(r.name);
  const addBlockRows = (m: Method, cls: string) => {
    m.params.forEach((p, index) => {
      const r = written.resolve(p.type.sugar);
      if (r.kind !== "block") return;
      if (!written.encodable(r)) return;
      const enc = [written.encode(r.returns), "@?", ...r.params.map(x => written.encode(x))].join("");
      const key = `${m.selector}\0${cls}\0${index}`;
      const before = blocks.get(key);
      // The same selector declared twice (a category, two protocols) must agree; a disagreement drops the row.
      if (before && before.types !== enc) conflicts.add(key);
      blocks.set(key, { selector: m.selector, class: cls, index, types: enc });
    });
  };
  const addBoolRows = (m: Method, cls: string) => {
    m.params.forEach((p, index) => {
      const r = types.resolve(p.type.sugar);
      if (r.kind !== "pointer" || r.to.kind !== "scalar" || r.to.name !== "BOOL") return;
      bools.set(`${m.selector}\0${cls}\0${index}`, { selector: m.selector, class: cls, index });
    });
  };
  const addCharRows = (m: Method, cls: string) => {
    const slots: (number | null)[] = [];
    if (isChar(types.resolve(m.returns.sugar))) slots.push(null);
    m.params.forEach((p, index) => {
      if (isChar(types.resolve(p.type.sugar))) slots.push(index);
    });
    for (const slot of slots) chars.set(`${m.selector}\0${cls}\0${slot}`, { selector: m.selector, class: cls, slot });
  };
  const addOwnershipRows = (m: Method, cls: string) => {
    const consumed = m.params.flatMap((p, index) => (p.consumed ? [index] : []));
    if (consumed.length === 0 && !m.consumesSelf && m.returnsRetained === null) return;
    const key = `${m.selector}\0${cls}`;
    const row = {
      selector: m.selector,
      class: cls,
      consumed,
      consumesSelf: m.consumesSelf,
      returnsRetained: m.returnsRetained,
    };
    const before = ownership.get(key);
    if (before && JSON.stringify(before) !== JSON.stringify(row)) {
      throw new Error(`${cls || "a protocol"} ${m.selector}: declared twice with different ownership`);
    }
    ownership.set(key, row);
  };
  const addArrayRows = (m: Method, cls: string) => {
    if (m.implicit) return;
    const keywords = keywordsOf(m);
    m.params.forEach((p, index) => {
      if (!isArrayParam(types, p, keywords[index], keywords[index + 1])) return;
      const key = `${m.selector}\0${cls}\0${index}`;
      arrays.set(key, {
        selector: m.selector,
        class: cls,
        index,
        counted: countedBy(types, index, keywords[index + 1], m.params[index + 1]),
      });
    });
  };

  for (const iface of ast.interfaces.values()) {
    for (const m of iface.methods) {
      if (m.variadic || m.params.some(takesVaList)) {
        variadic.set(`${m.selector}\0${iface.name}`, {
          selector: m.selector,
          class: iface.name,
          kind: variadicKind(m),
        });
      }
      addArrayRows(m, iface.name);
      addBlockRows(m, iface.name);
      addBoolRows(m, iface.name);
      addCharRows(m, iface.name);
      addOwnershipRows(m, iface.name);
    }
  }
  for (const p of ast.protocols.values()) {
    for (const m of p.methods) {
      if (m.variadic || m.params.some(takesVaList)) {
        // The bridge matches on the receiver's class chain; a protocol would
        // need a conformance check it does not have.
        throw new Error(`${p.name}: variadic ${m.selector} is declared outside an @interface`);
      }
      addArrayRows(m, "");
      addBlockRows(m, "");
      addBoolRows(m, "");
      addCharRows(m, "");
      addOwnershipRows(m, "");
    }
  }
  for (const key of conflicts) blocks.delete(key);
  // A protocol's row (class `""`) is applied to any receiver and is found
  // before a class's own row for the same selector and index, so the two
  // must not disagree.
  const disagreement = <R extends { selector: string; class: string; index: number }>(
    rows: Map<string, R>,
    payload: (r: R) => string,
    what: string,
  ) => {
    const ofProtocols = new Map<string, R>();
    for (const r of rows.values()) if (r.class === "") ofProtocols.set(`${r.selector}\0${r.index}`, r);
    for (const r of rows.values()) {
      const p = r.class !== "" ? ofProtocols.get(`${r.selector}\0${r.index}`) : undefined;
      if (p && payload(p) !== payload(r)) {
        throw new Error(
          `${what} ${r.index} of ${r.selector} is ${payload(p)} in a protocol and ${payload(r)} in ${r.class}`,
        );
      }
    }
  };
  disagreement(blocks, r => r.types, "block parameter");
  disagreement(arrays, r => r.counted, "array parameter");

  // An `assign` setter is a row; so is a subclass's redeclaration of one as
  // weak or strong (`NSTextView.delegate` over `NSText.delegate`), marked
  // false, so the nearest declaration in a receiver's class chain decides.
  const delegateSetters = new Map<string, Map<string, boolean>>();
  for (const iface of ast.interfaces.values()) {
    for (const p of iface.properties) {
      if (p.attributes.has("class") || p.attributes.has("readonly") || p.unavailable) continue;
      if (!/^id\s*<[^<>]+>$/.test(p.type.sugar.replace(NULLABILITY, "").trim())) continue;
      let setters = delegateSetters.get(iface.name);
      if (!setters) delegateSetters.set(iface.name, (setters = new Map()));
      const assign = !["weak", "strong", "retain", "copy"].some(a => p.attributes.has(a));
      // A class and its category may both declare it; assign if every declaration is.
      setters.set(p.setter, (setters.get(p.setter) ?? true) && assign);
    }
  }
  const assigns: AssignRow[] = [];
  for (const [cls, setters] of delegateSetters) {
    for (const [setter, assign] of setters) {
      let inheritsAssign = false;
      for (
        let c = ast.interfaces.get(cls)?.superclass;
        c !== undefined && c !== null && !inheritsAssign;
        c = ast.interfaces.get(c)?.superclass
      ) {
        inheritsAssign = delegateSetters.get(c)?.get(setter) === true;
      }
      if (assign || inheritsAssign) assigns.push({ selector: setter, class: cls, assign });
    }
  }

  const protocols: ProtocolRow[] = [];
  for (const p of ast.protocols.values()) {
    if (!inFramework(p.file, BRIDGED)) continue;
    const methods: ProtocolRow["methods"] = [];
    // The order the runtime lists them in: required before optional, instance before class, then by selector.
    for (const required of [true, false]) {
      for (const instance of [true, false]) {
        for (const m of p.methods) {
          if (m.optional === required || m.isClass === instance) continue;
          const pieces = [types.resolve(m.returns.sugar), ...m.params.map(q => types.paramType(q))];
          const hole = pieces.findIndex(r => !types.encodable(r));
          if (hole >= 0) {
            throw new Error(
              `${p.name} ${m.selector}: ${hole === 0 ? "the result" : `parameter ${hole - 1}`} (${hole === 0 ? m.returns.sugar : m.params[hole - 1].type.sugar}) has no whole type encoding`,
            );
          }
          methods.push({ selector: m.selector, types: types.methodTypes(m), required, instance });
        }
      }
    }
    methods.sort((a, b) => byColumns([a.selector], [b.selector]));
    protocols.push({ name: p.name, adopts: [...p.inherits], methods });
  }

  const mainThreadClasses = [...ast.interfaces.values()]
    .filter(i => i.mainActor && inFramework(i.file, ["AppKit"]))
    .map(i => i.name);

  // What a C function's declaration says about ownership: an attribute on
  // the function or an out-parameter; else, for a `Create`/`Copy` function,
  // a result declared as a Core Foundation type that encodes as a plain
  // object (`CFTypeRef`, `CFPropertyListRef`, a dispatch object), where the
  // bridge cannot see the Create Rule applies from the encoding alone.
  const bridged = new Types(ast, true);
  const functionOwnership: FunctionOwnershipRow[] = [];
  for (const [name, f] of ast.functions) {
    if (!f.exported || name.startsWith("_")) continue;
    const retainedOuts = f.params.flatMap((p, index) => (p.retainedOut ? [index] : []));
    let returnsRetained = f.returnsRetained;
    if (returnsRetained === null && /Create|Copy/.test(name)) {
      const r = bridged.resolve(f.returns.sugar);
      const declared = f.returns.sugar
        .replace(NULLABILITY, "")
        .replace(/\bconst\b/g, "")
        .trim();
      if (r.kind === "object" && (ast.objectTypedefs.has(declared) || /^dispatch_\w+_t$/.test(declared))) {
        returnsRetained = true;
      }
    }
    if (returnsRetained === null && UNDECLARED_RETAINED.has(name)) returnsRetained = true;
    if (returnsRetained === null && retainedOuts.length === 0) continue;
    functionOwnership.push({ name, returnsRetained, retainedOuts });
  }

  return {
    variadic: [...variadic.values()].sort((a, b) => byColumns([a.selector, a.class], [b.selector, b.class])),
    arrays: [...arrays.values()].sort((a, b) =>
      byColumns([a.selector, a.class, a.index], [b.selector, b.class, b.index]),
    ),
    assigns: assigns.sort((a, b) => byColumns([a.selector, a.class], [b.selector, b.class])),
    blocks: [...blocks.values()].sort((a, b) =>
      byColumns([a.selector, a.class, a.index], [b.selector, b.class, b.index]),
    ),
    protocols: protocols.sort((a, b) => byColumns([a.name], [b.name])),
    mainThreadClasses: mainThreadClasses.sort(),
    bools: [...bools.values()].sort((a, b) =>
      byColumns([a.selector, a.class, a.index], [b.selector, b.class, b.index]),
    ),
    ownership: [...ownership.values()].sort((a, b) => byColumns([a.selector, a.class], [b.selector, b.class])),
    chars: [...chars.values()].sort((a, b) =>
      byColumns([a.selector, a.class, a.slot ?? -1], [b.selector, b.class, b.slot ?? -1]),
    ),
    functionOwnership: functionOwnership.sort((a, b) => byColumns([a.name], [b.name])),
  };
}

// ─────────────────────────────── output ─────────────────────────────────────

const rustString = (s: string) => `c${JSON.stringify(s)}`;

/** One table's rows keyed the same way on both architectures, with the two payloads side by side. */
function paired<T>(arm: T[], intel: T[], key: (row: T) => string, what: string): { arm: T; intel: T }[] {
  const other = new Map(intel.map(r => [key(r), r]));
  const out = arm.map(r => {
    const twin = other.get(key(r));
    if (!twin) throw new Error(`${what} ${key(r).replaceAll("\0", " ")} is declared for arm64 only`);
    other.delete(key(r));
    return { arm: r, intel: twin };
  });
  if (other.size > 0)
    throw new Error(`${what} ${[...other.keys()][0].replaceAll("\0", " ")} is declared for x86_64 only`);
  return out;
}

export function generate(): string {
  const arm = tables(readSdk("arm64"));
  const intel = tables(readSdk("x86_64"));
  let usesByArch = false;
  const encoding = (a: string, b: string) => {
    if (a === b) return rustString(a);
    usesByArch = true;
    return `by_arch(${rustString(a)}, ${rustString(b)})`;
  };

  const variadicRows = paired(arm.variadic, intel.variadic, r => `${r.selector}\0${r.class}\0${r.kind}`, "variadic")
    .map(({ arm: r }) => `    ("${r.selector}", c"${r.class}", Variadic::${r.kind}),\n`)
    .join("");
  const arrayRows = paired(
    arm.arrays,
    intel.arrays,
    r => `${r.selector}\0${r.class}\0${r.index}\0${r.counted}`,
    "array",
  )
    .map(({ arm: r }) => `    ("${r.selector}", c"${r.class}", ${r.index}, ${r.counted}),\n`)
    .join("");
  const assignRows = paired(
    arm.assigns,
    intel.assigns,
    r => `${r.selector}\0${r.class}\0${r.assign}`,
    "assign property",
  )
    .map(({ arm: r }) => `    ("${r.selector}", c"${r.class}", ${r.assign}),\n`)
    .join("");
  const blockRows = paired(arm.blocks, intel.blocks, r => `${r.selector}\0${r.class}\0${r.index}`, "block parameter")
    .map(({ arm: r, intel: i }) => `    ("${r.selector}", c"${r.class}", ${r.index}, ${encoding(r.types, i.types)}),\n`)
    .join("");
  const protocolRows = paired(arm.protocols, intel.protocols, r => r.name, "protocol")
    .map(({ arm: p, intel: q }) => {
      if (p.adopts.join() !== q.adopts.join())
        throw new Error(`protocol ${p.name} adopts different protocols by architecture`);
      const methods = paired(
        p.methods,
        q.methods,
        m => `${m.selector}\0${m.required}\0${m.instance}`,
        `protocol ${p.name} method`,
      );
      return `    Protocol {\n        name: ${rustString(p.name)},\n        adopts: &[${p.adopts.map(rustString).join(", ")}],\n        methods: &[\n${methods
        .map(
          ({ arm: m, intel: n }) =>
            `            (${rustString(m.selector)}, ${encoding(m.types, n.types)}, ${m.required}, ${m.instance}),\n`,
        )
        .join("")}        ],\n    },\n`;
    })
    .join("");
  if (arm.mainThreadClasses.join() !== intel.mainThreadClasses.join()) {
    throw new Error("the NS_SWIFT_UI_ACTOR classes differ by architecture");
  }
  const boolRows = paired(arm.bools, intel.bools, r => `${r.selector}\0${r.class}\0${r.index}`, "BOOL parameter")
    .map(({ arm: r }) => `    ("${r.selector}", c"${r.class}", ${r.index}),\n`)
    .join("");
  const ownershipRows = paired(
    arm.ownership,
    intel.ownership,
    r => `${r.selector}\0${r.class}\0${r.consumed.join()}\0${r.consumesSelf}\0${r.returnsRetained}`,
    "ownership",
  )
    .map(
      ({ arm: r }) =>
        `    ("${r.selector}", c"${r.class}", &[${r.consumed.join(", ")}], ${r.consumesSelf}, ${r.returnsRetained === null ? "None" : `Some(${r.returnsRetained})`}),\n`,
    )
    .join("");

  const charRows = paired(arm.chars, intel.chars, r => `${r.selector}\0${r.class}\0${r.slot}`, "char slot")
    .map(({ arm: r }) => `    ("${r.selector}", c"${r.class}", ${r.slot === null ? "None" : `Some(${r.slot})`}),\n`)
    .join("");
  const functionOwnershipRows = paired(
    arm.functionOwnership,
    intel.functionOwnership,
    r => `${r.name}\0${r.returnsRetained}\0${r.retainedOuts.join()}`,
    "function ownership",
  )
    .map(
      ({ arm: r }) =>
        `    ("${r.name}", ${r.returnsRetained === null ? "None" : `Some(${r.returnsRetained})`}, &[${r.retainedOuts.join(", ")}]),\n`,
    )
    .join("");

  const hasAssignRow = (setter: string, cls: string, assign: boolean) =>
    arm.assigns.some(r => r.selector === setter && r.class === cls && r.assign === assign);
  if (
    !hasAssignRow("setDelegate:", "NSXMLParser", true) ||
    !hasAssignRow("setDataSource:", "NSComboBox", true) ||
    !hasAssignRow("setDelegate:", "NSTextView", false)
  ) {
    throw new Error(`assign delegate properties not read from the headers (got ${arm.assigns.length} rows)`);
  }
  if (!arm.mainThreadClasses.includes("NSResponder") || !arm.mainThreadClasses.includes("NSCell")) {
    throw new Error(`NS_SWIFT_UI_ACTOR classes not found in the AppKit headers (got ${arm.mainThreadClasses.length})`);
  }
  const hasBlockRow = (selector: string, cls: string, types: string) =>
    arm.blocks.some(r => r.selector === selector && r.class === cls && r.types === types);
  if (
    !hasBlockRow("enumerateObjectsUsingBlock:", "NSArray", "v@?@Q^B") ||
    !hasBlockRow("scheduledTimerWithTimeInterval:repeats:block:", "NSTimer", "v@?@") ||
    !hasBlockRow("beginSheet:completionHandler:", "NSWindow", "v@?q")
  ) {
    throw new Error(`block parameter types not read from the headers (got ${arm.blocks.length} rows)`);
  }
  if (!arm.protocols.some(p => p.name === "NSWindowDelegate" && p.methods.some(m => !m.required))) {
    throw new Error(`protocols not read from the headers (got ${arm.protocols.length})`);
  }
  if (
    !arm.bools.some(r => r.selector === "fileExistsAtPath:isDirectory:" && r.class === "NSFileManager" && r.index === 1)
  ) {
    throw new Error(`BOOL * parameters not read from the headers (got ${arm.bools.length} rows)`);
  }
  if (
    !arm.ownership.some(
      r =>
        r.selector === "unarchiver:didDecodeObject:" &&
        r.class === "" &&
        r.consumed.join() === "1" &&
        r.returnsRetained,
    ) ||
    !arm.ownership.some(r => r.selector === "awakeAfterUsingCoder:" && r.class === "NSObject" && r.consumesSelf)
  ) {
    throw new Error(`ownership attributes not read from the headers (got ${arm.ownership.length} rows)`);
  }

  if (!arm.chars.some(r => r.selector === "charValue" && r.class === "NSNumber" && r.slot === null)) {
    throw new Error(`char slots not read from the headers (got ${arm.chars.length} rows)`);
  }
  const hasFunctionRow = (name: string, returnsRetained: boolean | null) =>
    arm.functionOwnership.some(r => r.name === name && r.returnsRetained === returnsRetained);
  if (
    !hasFunctionRow("NSCopyMapTableWithZone", true) ||
    !hasFunctionRow("CFPreferencesCopyAppValue", true) ||
    !hasFunctionRow("CFPlugInInstanceGetFactoryName", true) ||
    hasFunctionRow("NSCreateFilenamePboardType", true)
  ) {
    throw new Error(`function ownership not read from the headers (got ${arm.functionOwnership.length} rows)`);
  }

  console.error(
    `${arm.variadic.length} variadic methods, ${arm.arrays.length} array parameters, ${arm.assigns.length} assign-property rows, ${arm.blocks.length} block parameters, ${arm.protocols.length} protocols (${arm.protocols.reduce((n, p) => n + p.methods.length, 0)} methods), ${arm.mainThreadClasses.length} main-thread classes, ${arm.bools.length} BOOL * parameters, ${arm.ownership.length} ownership rows, ${arm.chars.length} char slots, ${arm.functionOwnership.length} function ownership rows`,
  );

  return `// What the macOS SDK headers say about methods that their type encodings
// do not: which read a variable argument list (a trailing \`...\` or a
// \`va_list\` parameter), and which parameters are C arrays the method reads
// or fills (\`unichar *buffer\`, \`id objects[]\`, \`const CGFloat *components\`)
// rather than pointers to one value, and where their element count is;
// which setters store an \`assign\` delegate; what type each block parameter has,
// which the runtime encodes as a bare \`@?\`; every protocol Foundation,
// AppKit, QuartzCore, Metal and MetalKit declare, with its method
// descriptions as the compiler encodes them, for registering one that no
// loaded framework registers; the classes AppKit marks for the main
// thread only; which parameters are \`BOOL *\`, which the x86_64 runtime
// encodes like a C string; which methods state an ownership of an
// argument or their result that their selector does not; which parameters
// and results are a \`char\`, which the x86_64 runtime encodes like a
// \`BOOL\`; and which C functions state who owns an object they return or
// store. Generated from the clang AST of those frameworks' headers by
// scripts/appkit-sdk-methods.ts at build time; do not edit by hand.

use core::ffi::CStr;

use super::dynamic::{Counted, Variadic};

/// A protocol the headers declare, as clang describes it.
pub(super) struct Protocol {
    pub name: &'static CStr,
    /// The protocols it incorporates, by name.
    pub adopts: &'static [&'static CStr],
    /// (selector, type encoding, required, instance method), sorted by selector.
    pub methods: &'static [(&'static CStr, &'static CStr, bool, bool)],
}
${
  usesByArch
    ? `
/// A type encoding that differs by architecture: \`BOOL\` is \`B\` on arm64 and
/// \`c\` (a signed char) on x86_64.
const fn by_arch(arm64: &'static CStr, x86_64: &'static CStr) -> &'static CStr {
    if cfg!(target_arch = "x86_64") {
        x86_64
    } else {
        arm64
    }
}
`
    : ""
}
/// (selector, declaring class, what the variable arguments are), sorted by
/// selector for binary search.
#[rustfmt::skip]
pub(super) const VARIADIC: &[(&str, &CStr, Variadic)] = &[
${variadicRows}];

/// (selector, declaring class or \`c""\` for a protocol's method, argument
/// index from 0, which argument counts its elements), sorted by selector for
/// binary search.
#[rustfmt::skip]
pub(super) const ARRAY_PARAMS: &[(&str, &CStr, usize, Option<Counted>)] = &[
${arrayRows}];

/// (setter selector, declaring class, assign) of each object property typed
/// \`id <Protocol>\` and declared \`assign\`, and of each redeclaration of one
/// by a subclass as weak or strong (\`false\`): the nearest class in the
/// receiver's chain decides. Sorted by selector for binary search.
#[rustfmt::skip]
pub(super) const ASSIGN_PROPERTIES: &[(&str, &CStr, bool)] = &[
${assignRows}];

/// (selector, declaring class or \`c""\` for a protocol's method, argument
/// index from 0, the block's type encoding: return type, \`@?\`, one code per
/// argument, with \`BOOL\` written \`B\` on both architectures as a script
/// writes it), sorted by selector then class for binary search.
#[rustfmt::skip]
pub(super) const BLOCK_PARAMS: &[(&str, &CStr, usize, &CStr)] = &[
${blockRows}];

/// Sorted by name for binary search.
#[rustfmt::skip]
pub(super) const PROTOCOLS: &[Protocol] = &[
${protocolRows}];

/// The AppKit classes declared \`NS_SWIFT_UI_ACTOR\`, sorted by name.
#[rustfmt::skip]
pub(super) const MAIN_THREAD_CLASSES: &[&CStr] = &[
${arm.mainThreadClasses.map(name => `    c"${name}",\n`).join("")}];

/// (selector, declaring class or \`c""\` for a protocol's method, argument
/// index from 0) of each parameter declared \`BOOL *\`: \`^B\` on arm64, but
/// on x86_64 a bare \`*\`, the encoding of a C string, which the bridge
/// reads as the out-BOOL the header means. Sorted by selector for binary
/// search.
#[rustfmt::skip]
pub(super) const BOOL_PARAMS: &[(&str, &CStr, usize)] = &[
${boolRows}];

/// (selector, declaring class or \`c""\` for a protocol's method, the
/// arguments the method takes over the caller's reference to, whether it
/// takes over the receiver's too, whether its result comes retained) where
/// a header says so (NS_RELEASES_ARGUMENT, NS_REPLACES_RECEIVER,
/// NS_RETURNS_RETAINED, NS_RETURNS_NOT_RETAINED and the CF forms), over what
/// the selector's naming family says. Sorted by selector for binary search.
#[rustfmt::skip]
pub(super) const OWNERSHIP: &[(&str, &CStr, &[usize], bool, Option<bool>)] = &[
${ownershipRows}];

/// (selector, declaring class or \`c""\` for a protocol's method, argument
/// index from 0 or \`None\` for the result) of each parameter or result
/// declared \`char\` or \`signed char\`: \`c\`, which on x86_64 is also how the
/// runtime spells \`BOOL\`. Sorted by selector for binary search.
#[rustfmt::skip]
pub(super) const CHAR_SLOTS: &[(&str, &CStr, Option<usize>)] = &[
${charRows}];

/// (function name, whether its object result comes retained where a
/// header says so or the Create Rule applies to a result the encoding
/// shows as a plain object, the out-parameters whose stored object is the
/// caller's to release) for every exported function that declares any of
/// it. One row is not from the headers: \`NSCopyHashTableWithZone\` returns
/// a reference the caller owns (measured), though unlike its NSMapTable
/// twins it is not declared \`NS_RETURNS_RETAINED\`. Sorted by name for
/// binary search.
#[rustfmt::skip]
pub(super) const FUNCTION_OWNERSHIP: &[(&str, Option<bool>, &[usize])] = &[
${functionOwnershipRows}];
`;
}

/** Write sdk.rs into `outDir`. */
export function main(outDir: string): void {
  stamped(join(outDir, "sdk.rs"), generate());
}

if (import.meta.main) {
  if (!process.argv[2]) throw new Error("usage: bun scripts/appkit-sdk-methods.ts <out dir>");
  main(process.argv[2]);
}
