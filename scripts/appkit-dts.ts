#!/usr/bin/env bun
// TypeScript declarations for the Objective-C classes bun:objc hands out,
// so that `objc.classes.NSWindow`, `button.native` and what their methods
// return complete and type-check in an editor. Writes
// packages/bun-types/objc-sdk.d.ts, which a project opts into with
// `/// <reference types="bun-types/objc-sdk" />` (index.d.ts does not
// reference it: it is most of bun-types by size), and
// packages/bun-types/objc-sdk-stubs.d.ts, the empty interface per class
// that it merges into, which objc.d.ts references so that
// `objc.classes.NSWindow` and `window.native` have types of their own
// without it.
//
// The bridge reaches every class and selector of the frameworks it loads by
// name and converts arguments and results by each method's type encoding;
// the handle types in objc.d.ts (ObjCObject, ObjCClass) say only that much
// (every property is a method taking `any`). This asks the SDK's clang for
// the AST of the five frameworks' headers and writes, for the classes named
// in ROOTS below and their superclasses, one interface per class with its
// instance methods (`objc.NSWindow`) and one with its class methods
// (`objc.classes.NSWindow`), named the way the bridge spells selectors
// (`setFrame:display:` -> `setFrame_display_`) and typed the way it converts
// each C type (see the table under "Calling methods" in
// docs/runtime/objc.mdx). Methods a class inherits are not repeated; the
// index signature on ObjCObject/ObjCClass stays underneath, so a selector
// these headers do not declare still type-checks as `any`. The protocols
// those classes adopt, and the delegate and data-source protocols in
// PROTOCOL_ROOTS, get an interface each (`objc.protocols.X`). It also types
// `objc.enums` and `objc.functions` from the tables scripts/appkit-enums.ts
// writes to appkit_enums.ts at build time, read from the same AST.
//
// What is read per method: the selector and whether it is a class method;
// each parameter's name and C type with its nullability; the return type;
// `instancetype`; whether it is unavailable on macOS; its deprecation;
// whether its protocol marks it `@optional`. Which methods are variadic (and
// of those, which take objects), which pointer parameters are C arrays
// rather than out-parameters, and the type of each block parameter come
// from the tables the bridge itself consults (scripts/appkit-sdk-methods.ts,
// which writes sdk.rs from the same AST at build time), so the
// declarations agree with what a call does. The output is as of the SDK
// named in its first line; rerun this (or scripts/appkit-generate.ts, which
// runs every generator) when the build's SDK pin moves.
//
//   bun scripts/appkit-dts.ts           # rewrite the declarations
//   bun scripts/appkit-dts.ts --check   # exit 1 if they are stale

import { join } from "node:path";
import { type CFType, type EnumTables, enumTables } from "./appkit-enums";
import {
  type Ast,
  type CType,
  type Interface,
  type Method,
  pointsToConst,
  type Protocol,
  readSdk,
  type Resolved,
  root,
  splitParams,
  stamped,
  Types,
} from "./appkit-sdk";
import { type Tables, tables } from "./appkit-sdk-methods";
import { treeCounts } from "./appkit-tree-counts";

const OUT = join(root, "packages/bun-types/objc-sdk.d.ts");
/** The empty interface per class, which objc.d.ts references and so bun-types always loads. */
const STUBS_OUT = join(root, "packages/bun-types/objc-sdk-stubs.d.ts");

/**
 * The classes to declare, besides every superclass of these: what
 * src/js/bun/appkit.ts builds its windows, menus and views from (added
 * below from the source), and the Foundation and AppKit classes a script
 * dropping down to `objc` is likely to start from. A class outside this set
 * is still an `ObjCClass`/`ObjCObject`; this only decides what is spelled out.
 */
const ROOTS = new Set([
  // Foundation
  "NSObject",
  "NSString",
  "NSMutableString",
  "NSAttributedString",
  "NSMutableAttributedString",
  "NSNumber",
  "NSValue",
  "NSData",
  "NSMutableData",
  "NSDate",
  "NSURL",
  "NSArray",
  "NSMutableArray",
  "NSDictionary",
  "NSMutableDictionary",
  "NSSet",
  "NSMutableSet",
  "NSIndexSet",
  "NSMutableIndexSet",
  "NSEnumerator",
  "NSNull",
  "NSError",
  "NSException",
  "NSBundle",
  "NSProcessInfo",
  "NSUserDefaults",
  "NSNotification",
  "NSNotificationCenter",
  "NSFileManager",
  "NSRunLoop",
  "NSTimer",
  "NSThread",
  "NSJSONSerialization",
  "NSOperationQueue",
  "NSUndoManager",
  // AppKit
  "NSApplication",
  "NSRunningApplication",
  "NSWindow",
  "NSPanel",
  "NSView",
  "NSControl",
  "NSButton",
  "NSTextField",
  "NSSecureTextField",
  "NSSearchField",
  "NSTextView",
  "NSStackView",
  "NSScrollView",
  "NSClipView",
  "NSSplitView",
  "NSTableView",
  "NSTableColumn",
  "NSTableCellView",
  "NSBox",
  "NSImage",
  "NSImageView",
  "NSImageSymbolConfiguration",
  "NSBitmapImageRep",
  "NSColor",
  "NSColorSpace",
  "NSFont",
  "NSFontDescriptor",
  "NSMenu",
  "NSMenuItem",
  "NSScreen",
  "NSWorkspace",
  "NSPasteboard",
  "NSCursor",
  "NSEvent",
  "NSAlert",
  "NSOpenPanel",
  "NSSavePanel",
  "NSSound",
  "NSAnimationContext",
  "NSAppearance",
  "NSLayoutConstraint",
  "NSVisualEffectView",
  "NSSlider",
  "NSPopUpButton",
  "NSSegmentedControl",
  "NSProgressIndicator",
  "NSSwitch",
  "NSDatePicker",
  "NSStatusBar",
  "NSStatusItem",
  // QuartzCore, MetalKit
  "CALayer",
  "CATransaction",
  "MTKView",
  ...treeCounts(root).bridgedClasses,
]);

/** The protocols to declare besides the ones those classes adopt: the delegate and data-source protocols a script is likely to implement, typed as `objc.protocols.X`. */
const PROTOCOL_ROOTS = [
  "MTKViewDelegate",
  "NSApplicationDelegate",
  "NSControlTextEditingDelegate",
  "NSMenuDelegate",
  "NSSplitViewDelegate",
  "NSTableViewDataSource",
  "NSTableViewDelegate",
  "NSTextFieldDelegate",
  "NSTextViewDelegate",
  "NSWindowDelegate",
];

/** Selectors the bridge refuses or the handle answers itself (see src/js/bun/objc.ts). */
const RESERVED_SELECTORS = new Set([
  "retain",
  "autorelease",
  "retainCount",
  "dealloc",
  "zone",
  "performSelector:",
  "performSelector:withObject:",
  "performSelector:withObject:withObject:",
  "alloc",
  "new",
]);
/** Property names a handle answers itself, so a selector spelled that way is not reachable as a property. */
const RESERVED_PROPERTIES = new Set([
  "msgSend",
  "toString",
  "toJSON",
  "release",
  "invoke",
  "super",
  "then",
  "constructor",
]);

// ─────────────────────────────── C types ───────────────────────────────────

/** How the bridge treats one C type (mirrors `Enc::parse` in src/appkit/objc/dynamic.rs). */
type Shape =
  | { kind: "void" | "bool" | "float" | "class" | "sel" | "cstring" | "buffer" | "pointer" | "other" }
  /** `bridged` is the class a toll-free bridged type is (`NSString` for `CFStringRef`), "" for a plain CF type. */
  | { kind: "cf"; bridged: string }
  | { kind: "int"; bits: number; unsigned: boolean }
  /** `class` is the static class name for `X *`, null for `id`. */
  | { kind: "object"; class: string | null; instancetype: boolean }
  | { kind: "struct"; name: string }
  | { kind: "out"; to: Shape }
  | { kind: "block"; returns: Shape; params: { shape: Shape; nullable: boolean }[] };

/** Structs that cross as objects with field names (`StructType::field_names` in dynamic.rs) -> their type in objc.d.ts. */
const STRUCTS: Record<string, string> = {
  CGRect: "CGRect",
  CGPoint: "CGPoint",
  CGSize: "CGSize",
  CGVector: "CGVector",
  _NSRange: "NSRange",
  NSEdgeInsets: "NSEdgeInsets",
  NSDirectionalEdgeInsets: "NSDirectionalEdgeInsets",
  CGAffineTransform: "CGAffineTransform",
  CATransform3D: "CATransform3D",
};

/** The parsed SDK's types, read the way the bridge passes them, and its CF types by struct name (set by `generate`). */
let types: Types;
let cfTypes: Map<string, CFType>;

/** The type name as written, less qualifiers (`const NSWindowStyleMask` -> `NSWindowStyleMask`). */
const bareName = (sugar: string) =>
  sugar
    .replace(/\b(const|volatile|__kindof|_Nonnull|_Nullable_result|_Nullable|_Null_unspecified)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Whether the outermost pointer of a type as written is `_Nullable`: the
 * annotation trails an object pointer (`NSString * _Nullable`) and sits
 * inside a block pointer's declarator (`void (^ _Nullable)(BOOL)`). The few
 * declarations outside the audited headers (`<objc/NSObject.h>`: `-init`,
 * `-description`, `+alloc`) carry no annotation; those count as non-null for
 * a result and as nullable for a parameter, the way Swift imports them.
 */
const nullability = (sugar: string): "nullable" | "nonnull" | "unannotated" => {
  const block = /\(\^\s*(_Nonnull|_Nullable_result|_Nullable|_Null_unspecified)?\s*\)/.exec(sugar);
  const m = block
    ? block[1]
    : /\b(_Nonnull|_Nullable_result|_Nullable|_Null_unspecified)\s*$/.exec(
        sugar.replace(/\bconst\s*$/, "").trim(),
      )?.[1];
  return m === undefined ? "unannotated" : m === "_Nonnull" ? "nonnull" : "nullable";
};
const nullableResult = (sugar: string) => nullability(sugar) === "nullable";
const nullableParam = (sugar: string) => nullability(sugar) !== "nonnull";
const isBool = (r: Resolved) => r.kind === "scalar" && /^(BOOL|bool|_Bool)$/.test(r.name);

function shapeOf(type: CType): Shape {
  if (/^instancetype\b/.test(type.sugar)) return { kind: "object", class: null, instancetype: true };
  return shapeOfResolved(types.resolve(type.sugar), type.canon);
}

/** `printed`: the type as clang prints it desugared one level, when known, for the nullability of a block's parameters. */
function shapeOfResolved(r: Resolved, printed: string | null): Shape {
  switch (r.kind) {
    case "void":
      return { kind: "void" };
    case "scalar":
      if (isBool(r)) return { kind: "bool" };
      if (!types.converts(r)) return { kind: "other" };
      return r.integral ? { kind: "int", bits: r.size * 8, unsigned: /^[CSILQ]$/.test(r.enc) } : { kind: "float" };
    case "object":
      return { kind: "object", class: r.class, instancetype: false };
    case "class":
      return { kind: "class" };
    case "sel":
      return { kind: "sel" };
    case "block": {
      // `void (^)(NSEvent * _Nonnull)`: each parameter's nullability is in the printed type.
      const list = printed === null ? null : /\(\^[^)]*\)\s*\((.*)\)$/.exec(printed)?.[1];
      const params = list == null ? null : splitParams(list);
      const known = params !== null && params.length === r.params.length ? params : null;
      return {
        kind: "block",
        returns: shapeOfResolved(r.returns, null),
        params: r.params.map((p, i) => ({
          shape: shapeOfResolved(p, known?.[i] ?? null),
          nullable: known === null || nullableParam(known[i]),
        })),
      };
    }
    case "struct":
      return types.converts(r) ? { kind: "struct", name: r.tag ?? "?" } : { kind: "other" };
    case "pointer": {
      // What the encoding is to the bridge (`Enc::parse` in dynamic.rs): `*`
      // a C string (const) or byte buffer; `^X` storage for one X it converts
      // (a buffer it only reads when const), else a CF object by the struct
      // name, else a bare address.
      const to = r.to;
      const constant = pointsToConst(r);
      if (to.kind === "scalar" && to.size === 1 && to.integral && !isBool(to)) {
        return { kind: constant ? "cstring" : "buffer" };
      }
      const convertsOne =
        to.kind === "object" || ((to.kind === "scalar" || to.kind === "struct") && types.converts(to));
      if (convertsOne) return constant ? { kind: "buffer" } : { kind: "out", to: shapeOfResolved(to, null) };
      // `CFErrorRef *`, `CFDataRef *`: storage for a CF object, filled like
      // `NSError **` (the `const` of an immutable CF type is the object's, not the storage's).
      if (to.kind === "pointer") {
        const inner = shapeOfResolved(to, null);
        if (inner.kind === "cf") return { kind: "out", to: inner };
      }
      if (to.kind === "struct" && to.tag !== null && !(to.struct?.complete && to.struct.fields.length > 0)) {
        const cf = cfTypes.get(to.tag);
        if (cf) return { kind: "cf", bridged: cf.bridged };
      }
      return { kind: "pointer" };
    }
    case "array":
      return { kind: "buffer" };
    case "function":
    case "unknown":
      return { kind: "other" };
  }
}

// ─────────────────────────────── mapping ───────────────────────────────────

type Context = {
  /** Classes that get interfaces of their own. */
  emitted: Set<string>;
  interfaces: Map<string, Interface>;
  /** NS_ENUM / NS_OPTIONS type names, for parameters typed as one. */
  enumNames: Set<string>;
  enumsUsed: Set<string>;
};

/**
 * The signed (`NSInteger`) results documented to be NSNotFound, which is
 * 2^63 - 1 and so a bigint, when there is no match, by class and selector.
 * The other signed index results (`-[NSMenu indexOfItem:]`,
 * `-[NSPopUpButton indexOfSelectedItem]`) are -1 then and stay `number`;
 * unsigned results are `number | bigint` by their type.
 */
const RETURNS_NOT_FOUND = new Set(["NSSlider indexOfTickMarkAtPoint:", "NSSliderCell indexOfTickMarkAtPoint:"]);

/** What a parameter of the given object class accepts besides a handle: the boxing `objc.ns()` does. */
function boxedAs(cls: string | null, cx: Context): string | null {
  if (cls === null) return "objc.Id";
  const chain: string[] = [];
  for (let c: string | null = cls; c !== null; c = cx.interfaces.get(c)?.superclass ?? null) chain.push(c);
  if (cls === "NSObject") return "objc.Id";
  if (chain.includes("NSString")) return "string";
  if (cls === "NSValue" || chain.includes("NSNumber")) return "number | boolean | bigint";
  if (cls === "NSArray") return "readonly unknown[]";
  if (cls === "NSDictionary") return "{ readonly [key: string]: unknown }";
  if (cls === "NSData") return "ArrayBufferView | ArrayBufferLike";
  if (cls === "NSDate") return "Date";
  return null;
}

/** The instance type for a class: its own interface when emitted, else the nearest emitted superclass's. */
function instanceType(cls: string | null, cx: Context): string {
  for (let c = cls; c !== null; c = cx.interfaces.get(c)?.superclass ?? null) {
    if (cx.emitted.has(c)) return `objc.${c}`;
  }
  return "ObjCObject";
}

/** The alias for an enum-typed value, so the declaration names the enumeration (`objc.NSWindowStyleMask`). */
function numberType(type: CType, cx: Context): string {
  const name = bareName(type.sugar);
  if (cx.enumNames.has(name)) {
    cx.enumsUsed.add(name);
    return `objc.${name}`;
  }
  return "number";
}

function structType(name: string): string | null {
  return name in STRUCTS ? `objc.${STRUCTS[name]}` : null;
}

/** The type of a result (or of what a block hands its function). `self` is what `instancetype` means here. */
function returnType(
  type: CType,
  shape: Shape,
  cx: Context,
  self: string,
  nullable = nullableResult(type.sugar),
): string {
  const orNull = (t: string) => (nullable ? `${t} | null` : t);
  switch (shape.kind) {
    case "void":
      return "void";
    case "bool":
      return "boolean";
    case "int": {
      // An unsigned 64-bit result above 2^53 comes back as a bigint: NSNotFound, an NSUIntegerMax mask, -1 stored unsigned.
      const t = numberType(type, cx);
      return t === "number" && shape.bits === 64 && shape.unsigned ? "number | bigint" : t;
    }
    case "float":
      return "number";
    case "object":
      if (shape.instancetype) return orNull(self);
      return orNull(shape.class === null ? "ObjCObject" : instanceType(shape.class, cx));
    case "class":
      return orNull("ObjCClass");
    case "sel":
    case "cstring":
      return orNull("string");
    case "struct":
      return structType(shape.name) ?? "unknown[]";
    case "cf":
      return orNull(shape.bridged === "" ? "ObjCObject" : instanceType(shape.bridged, cx));
    case "block":
      return orNull("ObjCObject");
    case "out":
    case "buffer":
    case "pointer":
      return "bigint | null";
    case "other":
      return "unknown";
  }
}

/** The type a parameter accepts. */
function paramType(type: CType, shape: Shape, cx: Context, functionType: string | null): string {
  const nullable = nullableParam(type.sugar);
  const orNull = (t: string) => (nullable ? `${t} | null` : t);
  switch (shape.kind) {
    case "void":
      return "undefined";
    case "bool":
      return "boolean";
    case "int": {
      // A 64-bit value read back from one send (a bigint above 2^53: NSNotFound, an NSUIntegerMax mask) passes to the next.
      const t = numberType(type, cx);
      return shape.bits === 64 ? `${t} | bigint` : t;
    }
    case "float":
      return "number";
    case "object": {
      const boxed = shape.instancetype ? null : boxedAs(shape.class, cx);
      if (boxed === "objc.Id") return orNull("objc.Id");
      return orNull(boxed === null ? "ObjCObject" : `ObjCObject | ${boxed}`);
    }
    case "class":
      return orNull("ObjCClass");
    case "sel":
      return orNull("string | ObjCSelector");
    case "cstring":
      return orNull("string");
    case "struct": {
      // Every struct also takes an array of its members; a CGRect the flat `{x, y, width, height}` too.
      const t = structType(shape.name);
      if (t === null) return "readonly unknown[]";
      return `${t === "objc.CGRect" ? "objc.CGRect | objc.Rect" : t} | readonly number[]`;
    }
    case "cf": {
      // A toll-free bridged type takes what its class does.
      const boxed = shape.bridged === "" ? null : boxedAs(shape.bridged, cx);
      if (boxed === "objc.Id") return orNull("objc.Id");
      return orNull(boxed === null ? "ObjCObject" : `ObjCObject | ${boxed}`);
    }
    case "block":
      return orNull(functionType === null ? "ObjCObject" : `(${functionType}) | ObjCObject`);
    case "out": {
      // What is read back in `.value` is converted like a result of the pointee type.
      const to = shape.to;
      const inner =
        to.kind === "object"
          ? `${to.class === null ? "ObjCObject" : instanceType(to.class, cx)} | null`
          : to.kind === "cf"
            ? `${to.bridged === "" ? "ObjCObject" : instanceType(to.bridged, cx)} | null`
            : to.kind === "bool"
              ? "boolean"
              : to.kind === "struct"
                ? (structType(to.name) ?? "unknown[]")
                : to.kind === "int" && to.bits === 64 && to.unsigned
                  ? "number | bigint"
                  : "number";
      return `Partial<ObjCOut<${inner}>> | null`;
    }
    // Lent for the call: the callee reads or fills the buffer's bytes.
    case "buffer":
      return "ArrayBufferView | ArrayBuffer | null";
    case "pointer":
      return "ArrayBufferView | ArrayBuffer | bigint | null";
    case "other":
      return "unknown";
  }
}

/** The function type a block parameter accepts, given the encoding the bridge knows it by. */
function blockFunctionType(types: string, shape: Shape, cx: Context): string {
  // Names and classes from the header's block type when it lines up with the encoding; else from the encoding alone.
  const header = shape.kind === "block" ? shape : null;
  const codes = [
    ...types.matchAll(
      /@\?|\^[B@qv]|\{_NSRange=QQ\}|\{CGRect=\{CGPoint=dd\}\{CGSize=dd\}\}|\{CGPoint=dd\}|\{CGSize=dd\}|[vB@#:qQdfiIsScClL*]/g,
    ),
  ].map(m => m[0]);
  const ret = codes[0];
  const args = codes.slice(2); // past the return and `@?`
  const params = args.map((code, i) => {
    const declared = header && header.params.length === args.length ? header.params[i] : null;
    const name = `arg${i}`;
    switch (code) {
      case "@": {
        const d = declared?.shape;
        const t = d && d.kind === "object" && d.class !== null ? instanceType(d.class, cx) : "ObjCObject";
        return `${name}: ${declared === null || declared.nullable ? `${t} | null` : t}`;
      }
      case "@?":
        return `${name}: ObjCObject | null`;
      case "#":
        return `${name}: ObjCClass | null`;
      case ":":
      case "*":
        return `${name}: string | null`;
      case "B":
        return `${name}: boolean`;
      case "q":
      case "d":
      case "f":
      case "i":
      case "I":
      case "s":
      case "S":
      case "c":
      case "C":
      case "l":
      case "L":
        return `${name}: number`;
      case "Q":
        return `${name}: number | bigint`; // as a result is: a bigint above 2^53
      case "^B":
        return `stop: ObjCOut<boolean>`;
      case "^@":
        return `${name}: ObjCOut<ObjCObject | null>`;
      case "^q":
        return `${name}: ObjCOut<number>`;
      // `const void *bytes`: the address.
      case "^v":
        return `${name}: bigint`;
      case "{_NSRange=QQ}":
        return `${name}: objc.NSRange`;
      case "{CGRect={CGPoint=dd}{CGSize=dd}}":
        return `${name}: objc.CGRect`;
      case "{CGPoint=dd}":
        return `${name}: objc.CGPoint`;
      case "{CGSize=dd}":
        return `${name}: objc.CGSize`;
      default:
        return `${name}: unknown`;
    }
  });
  const returns =
    ret === "v"
      ? "void"
      : ret === "B"
        ? "boolean"
        : /^[qQdfiIsScClL]$/.test(ret)
          ? "number"
          : ret === "@" || ret === "#"
            ? "objc.Id | null"
            : "unknown";
  return `(${params.join(", ")}) => ${returns}`;
}

// ─────────────────────────────── emission ──────────────────────────────────

/** `count:with:` -> `count_with_` (propertyFromSelector in src/js/bun/objc.ts). */
function propertyFromSelector(selector: string): string {
  let lead = 0;
  while (lead < selector.length && selector.charCodeAt(lead) === 95) lead++;
  return selector.slice(0, lead) + selector.slice(lead).replaceAll("_", "__").replaceAll(":", "_");
}

/** `PNGFileType` -> `pngFileType` (lowerFirstWord in src/js/bun/objc.ts). */
function lowerFirstWord(suffix: string): string {
  const first = /^[A-Z]+(?![a-z])|^[A-Z]/.exec(suffix)?.[0] ?? "";
  return first.toLowerCase() + suffix.slice(first.length);
}

const KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum",
  "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null",
  "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with",
  "implements", "interface", "let", "package", "private", "protected", "public", "static", "yield", "arguments",
]); // prettier-ignore

type Member = { property: string; text: string; returns: string; params: string; optional: boolean };

/** What for...of yields on the collections src/js/bun/objc.ts `iteratorOf` makes iterable (their subclasses inherit it). */
const ITERATES: Record<string, [type: string, doc: string]> = {
  NSArray: ["ObjCObject", "The elements, first to last (`-objectEnumerator`)."],
  NSSet: ["ObjCObject", "The members (`-objectEnumerator`)."],
  NSOrderedSet: ["ObjCObject", "The members, first to last (`-objectEnumerator`)."],
  NSHashTable: ["ObjCObject", "The members (`-objectEnumerator`)."],
  NSEnumerator: ["ObjCObject", "What the enumerator has left (`-nextObject` until nil)."],
  NSDictionary: ["ObjCObject", "The keys (`-keyEnumerator`)."],
  NSMapTable: ["ObjCObject", "The keys (`-keyEnumerator`)."],
  NSIndexSet: ["number", "The indexes in increasing order (`-firstIndex`, `-indexGreaterThanIndex:`)."],
};

/** Every superclass of `name`, nearest first. */
function ancestorsOf(name: string, interfaces: Map<string, Interface>): string[] {
  const out: string[] = [];
  for (let c = interfaces.get(name)?.superclass ?? null; c !== null; c = interfaces.get(c)?.superclass ?? null) {
    out.push(c);
  }
  return out;
}

/** The protocols a class adopts (directly or through its categories), with the protocols those incorporate. */
function protocolsOf(iface: Interface, protocols: Map<string, Protocol>): Protocol[] {
  const seen = new Set<string>();
  const out: Protocol[] = [];
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const p = protocols.get(name);
    if (!p) return;
    out.push(p);
    for (const parent of p.inherits) visit(parent);
  };
  for (const name of iface.protocols) visit(name);
  return out;
}

/** Bun runs on macOS 13.0 and later; a method newer than that is the one a hover should date. */
const MACOS_FLOOR = [13, 0];
function newerThanFloor(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > MACOS_FLOOR[0] || (major === MACOS_FLOOR[0] && minor > MACOS_FLOOR[1]);
}

function generate(ast: Ast): { declarations: string; stubs: string } {
  const { interfaces, protocols } = ast;
  const enums: EnumTables = enumTables();
  types = new Types(ast, true);
  cfTypes = enums.cfTypes;
  const sdk: Tables = tables(ast);

  const emitted = new Set<string>();
  for (const name of ROOTS) {
    if (!interfaces.has(name)) throw new Error(`${name} is not a class these frameworks declare`);
    emitted.add(name);
    for (const a of ancestorsOf(name, interfaces)) emitted.add(a);
  }
  // Superclasses first, so a class can see what it inherits.
  const order = [...emitted].sort(
    (a, b) => ancestorsOf(a, interfaces).length - ancestorsOf(b, interfaces).length || (a < b ? -1 : 1),
  );
  const cx: Context = { emitted, interfaces, enumNames: new Set(enums.enums.keys()), enumsUsed: new Set() };

  const inherits = (cls: string, from: string) => cls === from || ancestorsOf(cls, interfaces).includes(from);
  /** A `(selector, class[, index])` row applies to a class inheriting the row's class; a `""` row (a protocol's method) to any. */
  const rowFor = <R extends { selector: string; class: string; index?: number }>(
    rows: R[],
    cls: string,
    selector: string,
    index: number,
  ) =>
    rows.find(r => r.selector === selector && (r.index ?? -1) === index && (r.class === "" || inherits(cls, r.class)));
  /** Whether a result type is assignable to an inherited one: the same, or an object type narrowed to a subclass or `this`, not newly nullable. */
  const refines = (returns: string, inherited: string, cls: string): boolean => {
    const bare = (t: string) => t.replace(/ \| null$/, "");
    if (returns.endsWith(" | null") && !inherited.endsWith(" | null")) return false;
    const [sub, base] = [bare(returns), bare(inherited)];
    if (sub === base) return true;
    const object = /^(?:objc\.(\w+)|ObjCObject|this)$/;
    const [s, b] = [object.exec(sub), object.exec(base)];
    if (!s || !b || base === "this") return false;
    if (base === "ObjCObject") return true;
    const narrowed = sub === "this" ? cls : s[1];
    return narrowed !== undefined && b[1] !== undefined && inherits(narrowed, b[1]);
  };
  const memberText = (m: Omit<Member, "text">) => `${m.property}${m.optional ? "?" : ""}(${m.params}): ${m.returns};`;
  /** Whether member `a` may be declared where `b` is inherited: the same parameters, a result that refines, and not newly optional. */
  const fits = (a: Member, b: Member, cls: string): boolean =>
    a.params === b.params && refines(a.returns, b.returns, cls) && (!a.optional || b.optional);
  /** The one declaration that fits where both `a` and `b` are inherited (the narrower result, optional only if both are), or null. */
  const common = (a: Member, b: Member, cls: string): Member | null => {
    if (a.params !== b.params) return null;
    const returns = refines(a.returns, b.returns, cls)
      ? a.returns
      : refines(b.returns, a.returns, cls)
        ? b.returns
        : null;
    if (returns === null) return null;
    const merged = { property: a.property, params: a.params, returns, optional: a.optional && b.optional };
    return { ...merged, text: memberText(merged) };
  };

  /** One method as an interface member, or null when it is not reachable through a handle. */
  function member(m: Method, cls: string, side: "instance" | "class"): Member | null {
    // `origin::size:` (an empty selector part) has no property spelling; msgSend reaches it.
    if (m.unavailable || RESERVED_SELECTORS.has(m.selector) || m.selector.includes("::")) return null;
    // A variadic method takes objects after its named arguments when its
    // list is nil-terminated or a format's; the bridge refuses the others.
    const variadic = rowFor(sdk.variadic, cls, m.selector, -1)?.kind.replace(/\(\d+\)$/, "");
    if (variadic !== undefined && variadic !== "Objects" && variadic !== "Format") return null;
    const property = propertyFromSelector(m.selector);
    if (RESERVED_PROPERTIES.has(property)) return null;
    // Deprecated methods that a category puts on NSObject are the informal
    // protocols of old (delegate methods any object "might" implement);
    // nothing answers them unless it chose to, so they are left to the index
    // signature rather than listed on every object.
    if (m.owner === "NSObject" && m.category !== null && m.deprecated !== null) return null;

    const self = side === "instance" ? "this" : instanceType(cls, cx);
    const retShape = shapeOf(m.returns);
    // A type the bridge refuses (`NSDecimal`, a struct with bit-fields) makes
    // the send a TypeError; the index signature still admits the selector.
    if (retShape.kind === "other" || m.params.some(p => shapeOf(p.type).kind === "other")) return null;
    let returns = returnType(m.returns, retShape, cx, self);
    if (returns === "number" && RETURNS_NOT_FOUND.has(`${m.owner} ${m.selector}`)) returns = "number | bigint";

    // A pointer-to-value or `char *` parameter the bridge's table lists as a
    // C array is a buffer; a `void *` it lists stays a pointer (sized, but an address fits too).
    const shapes = m.params.map((p, i): Shape => {
      const shape = shapeOf(p.type);
      const listed = (shape.kind === "out" || shape.kind === "cstring") && rowFor(sdk.arrays, cls, m.selector, i);
      return listed ? { kind: "buffer" } : shape;
    });
    // Trailing out-parameters may be left off (the bridge passes NULL).
    let optionalFrom = shapes.length;
    while (optionalFrom > 0 && shapes[optionalFrom - 1].kind === "out") optionalFrom--;
    const taken = new Set<string>();
    const params = m.params.map((p, i) => {
      const shape = shapes[i];
      let functionType: string | null = null;
      if (shape.kind === "block") {
        const row = rowFor(sdk.blocks, cls, m.selector, i);
        if (row) functionType = blockFunctionType(row.types, shape, cx);
      }
      let name = p.name;
      if (KEYWORDS.has(name)) name += "_";
      while (taken.has(name)) name += "_";
      taken.add(name);
      let type = paramType(p.type, shape, cx, functionType);
      // The first of a nil-terminated list may be the nil: `arrayWithObjects:nil` is the empty array.
      if (variadic === "Objects" && i === shapes.length - 1 && !type.endsWith(" | null")) type += " | null";
      return `${name}${i >= optionalFrom ? "?" : ""}: ${type}`;
    });
    // A nil among the variable arguments of a nil-terminated list would end it (the bridge adds the terminator); a `%@` may take nil.
    if (variadic !== undefined)
      params.push(variadic === "Objects" ? "...objects: objc.Id[]" : "...objects: (objc.Id | null)[]");
    const built = { property, returns, params: params.join(", "), optional: m.optional };
    return { ...built, text: memberText(built) };
  }

  // An interface as built: its qualified name and every member it declares
  // or inherits, by property name (what an extending interface must fit).
  type Built = { type: string; declared: Map<string, Member> };
  const OBJECT: Built = { type: "ObjCObject", declared: new Map() };
  const CLASS: Built = { type: "ObjCClass", declared: new Map() };
  let methodCount = 0;

  /**
   * The body of an interface extending `bases` that declares `candidates`
   * (first wins per property). A member some base already declares is
   * declared again only when it narrows that result with the same
   * parameters (or makes an optional one required); anything else keeps
   * the inherited declaration, which TypeScript requires a redeclaration
   * to fit. Where two bases disagree about a member, the one declaration
   * that fits both (the narrower result; required unless both are
   * optional) is repeated in the body, as TypeScript also requires; when
   * there is none the later base cannot be extended and is reported in
   * `fold`, for the caller to declare its members in the body instead.
   */
  function build(
    candidates: Method[],
    cls: string,
    side: "instance" | "class",
    bases: Built[],
  ): { body: string[]; declared: Map<string, Member>; fold: Built | null } {
    const inherited = new Map<string, Member>();
    const restate = new Map<string, Member>();
    for (const base of bases) {
      for (const [property, mem] of base.declared) {
        const before = inherited.get(property);
        if (!before || before.text === mem.text) {
          inherited.set(property, mem);
          continue;
        }
        const merged = common(before, mem, cls);
        if (!merged) return { body: [], declared: inherited, fold: base };
        inherited.set(property, merged);
        restate.set(property, merged);
      }
    }
    const own = new Map<string, Member>();
    const body: string[] = [];
    for (const m of candidates) {
      if (m.isClass !== (side === "class")) continue;
      const mem = member(m, cls, side);
      if (!mem || own.has(mem.property)) continue;
      const before = inherited.get(mem.property);
      if (before && (mem.text === before.text || !fits(mem, before, cls))) continue;
      own.set(mem.property, mem);
      restate.delete(mem.property);
      const notes = [
        ...(m.introduced !== null && newerThanFloor(m.introduced) ? [`@since macOS ${m.introduced}`] : []),
        ...(m.deprecated !== null ? [`@deprecated ${m.deprecated.replace(/\*\//g, "* /")}`] : []),
      ];
      if (notes.length > 0) body.push(`/** ${notes.join(" ")} */`);
      body.push(mem.text);
      methodCount++;
    }
    for (const mem of restate.values()) body.push(mem.text);
    return { body, declared: new Map([...inherited, ...own]), fold: null };
  }

  /** `build`, folding each base it cannot extend into the candidates until the rest fit. */
  function buildFolding(
    candidates: Method[],
    cls: string,
    side: "instance" | "class",
    bases: Built[],
    membersOf: (b: Built) => Method[],
  ) {
    for (;;) {
      const built = build(candidates, cls, side, bases);
      if (!built.fold) return { ...built, bases };
      const folded = built.fold;
      bases = bases.filter(b => b !== folded);
      candidates = [...candidates, ...membersOf(folded)];
    }
  }

  const emit = (into: string[], pad: string, doc: string, name: string, bases: string[], body: string[]) => {
    into.push(`${pad}/** ${doc} */`);
    if (body.length === 0) {
      into.push(`${pad}interface ${name} extends ${bases.join(", ")} {}`);
    } else {
      into.push(`${pad}interface ${name} extends ${bases.join(", ")} {`, ...body.map(l => `${pad}  ${l}`), `${pad}}`);
    }
  };

  // ── protocols: one interface each, for the classes below to extend ──
  const protocolLines: string[] = [];
  const builtProtocols = new Map<string, Built>();
  /** Every method a protocol requires or offers, its inherited protocols' included. */
  const protocolMethods = (name: string): Method[] => {
    const seen = new Set<string>();
    const out: Method[] = [];
    const visit = (n: string) => {
      const p = protocols.get(n);
      if (!p || seen.has(n)) return;
      seen.add(n);
      out.push(...p.methods);
      for (const q of p.inherits) visit(q);
    };
    visit(name);
    return out;
  };
  const protocolMethodsOf = (b: Built) => protocolMethods(b.type.replace(/^protocols\./, ""));
  /** Whether protocol `q` incorporates protocol `p` (directly or through the protocols it incorporates). */
  const incorporates = (q: string, p: string): boolean => {
    const inherits = protocols.get(q)?.inherits;
    return inherits !== undefined && (inherits.has(p) || [...inherits].some(r => incorporates(r, p)));
  };
  function buildProtocol(name: string): Built | null {
    const existing = builtProtocols.get(name);
    if (existing) return existing;
    const p = protocols.get(name);
    if (!p) return null;
    const parents = [...p.inherits].map(buildProtocol).filter((b): b is Built => b !== null);
    const { body, declared, bases } = buildFolding(
      p.methods,
      name,
      "instance",
      parents.length ? parents : [OBJECT],
      protocolMethodsOf,
    );
    const built: Built = { type: `protocols.${name}`, declared };
    builtProtocols.set(name, built);
    emit(
      protocolLines,
      "      ",
      `What an object conforming to \`${name}\` answers. The optional methods (\`@optional\`) it may not: test \`"method_" in object\` (\`respondsToSelector:\`) before calling one, since reading any selector off a handle gives a function and \`?.()\` therefore still sends.`,
      name,
      bases.map(b => b.type),
      body,
    );
    return built;
  }

  for (const name of PROTOCOL_ROOTS) {
    if (!buildProtocol(name)) throw new Error(`${name} is not a protocol these frameworks declare`);
  }

  // ── classes ──
  const builtClasses = { instance: new Map<string, Built>(), class: new Map<string, Built>() };
  const lines: string[] = [];
  const classLines: string[] = [];
  for (const cls of order) {
    const iface = interfaces.get(cls)!;
    const chain = ancestorsOf(cls, interfaces);
    const parent = chain[0] ?? null;
    // The protocols this class adds to what its superclasses adopt, less
    // those another one of them already incorporates.
    const inheritedProtocols = new Set(chain.flatMap(a => protocolsOf(interfaces.get(a)!, protocols).map(p => p.name)));
    const added = [...iface.protocols].filter(p => protocols.has(p) && !inheritedProtocols.has(p));
    const adopted = added.filter(p => !added.some(q => q !== p && incorporates(q, p)));

    // Instance side: the superclass, then each adopted protocol.
    {
      const bases = [parent !== null ? builtClasses.instance.get(parent)! : OBJECT];
      for (const p of adopted) {
        const b = buildProtocol(p);
        if (b) bases.push(b);
      }
      const { body, declared, bases: kept } = buildFolding(iface.methods, cls, "instance", bases, protocolMethodsOf);
      if (cls in ITERATES) {
        body.unshift(`/** ${ITERATES[cls][1]} */`, `[Symbol.iterator](): IterableIterator<${ITERATES[cls][0]}>;`);
      }
      builtClasses.instance.set(cls, { type: `objc.${cls}`, declared });
      emit(
        lines,
        "    ",
        `An \`${cls}\` instance.`,
        cls,
        kept.map(b => b.type),
        body,
      );
    }
    // Class side: the superclass's; a protocol's class methods are declared
    // here directly, and class methods that return `instancetype` are
    // declared again on each subclass with that subclass as the result
    // (`NSMutableArray.array()`).
    {
      const bases = [parent !== null ? builtClasses.class.get(parent)! : CLASS];
      const factories: Method[] = chain.flatMap(a => {
        const ai = interfaces.get(a)!;
        return [...ai.methods, ...protocolsOf(ai, protocols).flatMap(p => p.methods)].filter(
          m => m.isClass && shapeOf(m.returns).kind === "object" && /^instancetype\b/.test(m.returns.sugar),
        );
      });
      const candidates = [...iface.methods, ...adopted.flatMap(protocolMethods), ...factories];
      const { body, declared } = build(candidates, cls, "class", bases);
      body.unshift(`readonly alloc: () => objc.${cls};`, `readonly new: () => objc.${cls};`);
      builtClasses.class.set(cls, { type: `classes.${cls}`, declared });
      emit(
        classLines,
        "      ",
        `The \`${cls}\` class object (\`objc.classes.${cls}\`).`,
        cls,
        bases.map(b => b.type),
        body,
      );
    }
  }

  // ── objc.functions ──
  const functionLines: string[] = [];
  for (const [name, { format }] of enums.functions) {
    const declared = ast.functions.get(name)!;
    const taken = new Set<string>();
    const shapes = declared.params.map(p => shapeOf(p.type));
    let optionalFrom = shapes.length;
    while (optionalFrom > 0 && shapes[optionalFrom - 1].kind === "out") optionalFrom--;
    const params = declared.params.map((p, i) => {
      let pname = p.name || `arg${i}`;
      if (KEYWORDS.has(pname)) pname += "_";
      while (taken.has(pname)) pname += "_";
      taken.add(pname);
      return `${pname}${i >= optionalFrom ? "?" : ""}: ${paramType(p.type, shapes[i], cx, null)}`;
    });
    if (format !== null) params.push("...objects: (objc.Id | null)[]");
    const retShape = shapeOf(declared.returns);
    // A `Create`/`Copy` function's CF result is the caller's; anything else unannotated may be NULL.
    const returns = returnType(declared.returns, retShape, cx, "ObjCObject");
    functionLines.push(`    ${name}(${params.join(", ")}): ${returns};`);
  }

  // ── objc.enums ──
  const enumLines: string[] = [];
  /** Members by full name: the `bigint` ones as lines of `Enums`, the rest as the names in `EnumMember`. */
  const bigMembers: string[] = [];
  const memberNames: string[] = [];
  /** Enumerations with a member above 2^53, whose alias is therefore `number | bigint`. */
  const bigEnums = new Set<string>();
  for (const [name, { members }] of enums.enums) {
    const numbers: string[] = [];
    const bigints: string[] = [];
    for (const m of members) {
      if (m.big) {
        bigEnums.add(name);
        bigMembers.push(`    readonly ${m.name}: bigint;`);
      } else {
        memberNames.push(JSON.stringify(m.name));
      }
      if (m.suffix.startsWith("=")) continue;
      (m.big ? bigints : numbers).push(JSON.stringify(lowerFirstWord(m.suffix)));
    }
    const args = [numbers.length ? numbers.join(" | ") : "never"];
    if (bigints.length) args.push(bigints.join(" | "));
    enumLines.push(`    readonly ${name}: ObjCEnum<${args.join(", ")}>;`);
  }
  const looseLines = [...enums.loose]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, { big }]) => `    readonly ${name}: ${big ? "bigint" : "number"};`);

  const out: string[] = [];
  out.push("// Generated by scripts/appkit-dts.ts from the macOS SDK's Foundation, AppKit, QuartzCore, Metal");
  out.push("// and MetalKit headers; do not edit. `bun scripts/appkit-dts.ts` rewrites it.");
  out.push("//");
  out.push("// The Objective-C classes bun:objc is most often asked for, as TypeScript sees");
  out.push("// them through a handle: `objc.NSWindow` is an NSWindow instance (its instance methods and its");
  out.push("// superclasses'), `objc.classes.NSWindow` the class (its class methods). Methods are named the");
  out.push("// way the bridge spells selectors (`setFrame:display:` is `setFrame_display_`) and typed the way");
  out.push("// it converts each argument and result; objc.d.ts describes the conversions and declares the");
  out.push("// handle types these extend, whose index signature still admits any other selector.");
  out.push("//");
  out.push("// bun-types does not load this file by default (index.d.ts does not reference it). A project that");
  out.push("// uses the bridge opts in from any one of its files with");
  out.push("//");
  out.push('//   /// <reference types="bun-types/objc-sdk" />');
  out.push("//");
  out.push("// Until then every class is a plain ObjCClass / ObjCObject whose selectors are all `any`, and so is");
  out.push("// every name in `objc.enums`.");
  out.push("");
  out.push('declare module "bun:objc" {');
  out.push("  namespace objc {");
  for (const name of [...cx.enumsUsed].sort()) {
    const big = bigEnums.has(name);
    out.push(
      `    /** A member of {@link Enums.${name} \`objc.enums.${name}\`}${big ? "; a `bigint` for the ones above 2^53" : ""}. */`,
    );
    out.push(`    type ${name} = ${big ? "number | bigint" : "number"};`);
  }
  out.push("");
  out.push(
    "    /** Every enumeration member whose value is a plain number, by its full name (what `objc.enums` also answers flat). */",
  );
  out.push(`    type EnumMember = ${memberNames.join(" | ")};`);
  out.push("");
  out.push(
    "    /** What {@link ObjC.enums `objc.enums`} holds by name: each enumeration with its members, then every constant that stands alone, then (through `EnumMember` and the `bigint` lines) every member flat. */",
  );
  out.push("    interface Enums extends Readonly<Record<EnumMember, number>> {");
  out.push(...enumLines);
  out.push(...looseLines);
  out.push(...bigMembers);
  out.push("    }");
  out.push("");
  out.push(
    "    /** What {@link ObjC.functions `objc.functions`} holds by name: the C functions Foundation, AppKit, CoreGraphics and CoreFoundation export whose argument and result types the bridge converts. */",
  );
  out.push("    interface Functions {");
  out.push(...functionLines);
  out.push("    }");
  out.push("");
  out.push("    namespace protocols {");
  out.push(...protocolLines);
  out.push("    }");
  out.push("");
  out.push(...lines);
  out.push("");
  out.push("    namespace classes {");
  out.push(...classLines);
  out.push("    }");
  out.push("  }");
  out.push("}");
  out.push("");

  // The empty interfaces those merge into, each extending its superclass's
  // as above (a merged interface's bases must agree).
  const known = [...emitted].sort();
  const parentOf = (cls: string) => interfaces.get(cls)!.superclass;
  const stubs: string[] = [];
  stubs.push("// Generated by scripts/appkit-dts.ts; do not edit. `bun scripts/appkit-dts.ts` rewrites it.");
  stubs.push("//");
  stubs.push("// The classes objc-sdk.d.ts declares, as the empty interfaces it merges their methods into.");
  stubs.push("// objc.d.ts references this file, so that `objc.classes.NSWindow` and `window.native` have types");
  stubs.push("// of their own, and destructure under `noUncheckedIndexedAccess`, whether or not a project has");
  stubs.push("// opted into that one.");
  stubs.push("");
  stubs.push('declare module "bun:objc" {');
  stubs.push("  namespace objc {");
  for (const cls of known) stubs.push(`    interface ${cls} extends ${parentOf(cls) ?? "ObjCObject"} {}`);
  stubs.push("    namespace classes {");
  for (const cls of known) stubs.push(`      interface ${cls} extends ${parentOf(cls) ?? "ObjCClass"} {}`);
  stubs.push("    }");
  stubs.push("  }");
  stubs.push("");
  stubs.push("  /**");
  stubs.push("   * The classes {@link ObjC.classes `objc.classes`} names a type for, so");
  stubs.push("   * that destructuring them type-checks under `noUncheckedIndexedAccess`");
  stubs.push("   * and, once bun-types/objc-sdk.d.ts is referenced, their methods");
  stubs.push("   * complete. Every other name is an {@link ObjCClass} too.");
  stubs.push("   */");
  stubs.push("  interface ObjCKnownClasses {");
  for (const cls of known) stubs.push(`    readonly ${cls}: objc.classes.${cls};`);
  stubs.push("  }");
  stubs.push("}");
  stubs.push("");

  console.error(
    `${emitted.size} classes, ${builtProtocols.size} protocols, ${methodCount} methods, ${enumLines.length} enums (${memberNames.length + bigMembers.length} members), ${looseLines.length} constants, ${functionLines.length} functions`,
  );
  return { declarations: out.join("\n"), stubs: stubs.join("\n") };
}

export function main(): void {
  const { declarations, stubs } = generate(readSdk("arm64"));
  stamped(STUBS_OUT, stubs, false);
  stamped(OUT, declarations);
}

if (import.meta.main) main();
