// An exported function, class, enum or namespace of a namespace is a binding of its block, and its statement copies it to the property: key order, calls above the declaration, stores to the property from outside.
declare const console: { log(...values: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

namespace Ordered {
  export const first = 1;
  export function second() { return 2; }
  export class Third {}
  export enum Fourth { A }
  export namespace Fifth { export const inner = 5; }
  export let sixth = 6;
}
row("keys in statement order", () => keys(Ordered));

namespace Hoisted {
  export const keysAtCall = later();
  export const typeAtCall = typeof (Hoisted as any).later;
  export function later() { return "[" + keys(Hoisted) + "]"; }
  export const typeBehind = typeof (Hoisted as any).later;
}
row("a call above the declaration", () => Hoisted.keysAtCall);
row("the property above the declaration", () => Hoisted.typeAtCall);
row("the property behind the declaration", () => Hoisted.typeBehind);
row("keys with a hoisted function", () => keys(Hoisted));

namespace Replaced {
  export function f() { return "declared"; }
  export class C { static who = "declared"; }
  export function callInBlock() { return f(); }
  export function classInBlock() { return C.who; }
}
namespace Replaced {
  export function callInOtherBlock() { return f(); }
  export function classInOtherBlock() { return C.who; }
}
(Replaced as any).f = () => "stored";
(Replaced as any).C = class { static who = "stored"; };
row("a function, in its block", () => Replaced.callInBlock());
row("a function, in another block", () => Replaced.callInOtherBlock());
row("a function, from outside", () => Replaced.f());
row("a class, in its block", () => Replaced.classInBlock());
row("a class, in another block", () => Replaced.classInOtherBlock());

namespace Holder {
  export enum Level { Low = "low" }
  export namespace Nested {
    export let value = "declared";
    export function read() { return value; }
  }
  export function levelKeys() { return keys(Level); }
  export function nestedValue() { return Nested.value; }
}
const nested = Holder.Nested;
(Holder as any).Level = { Stored: 1 };
(Holder as any).Nested = { value: "stored" };
row("an enum, in its block", () => Holder.levelKeys());
row("an enum, from outside", () => keys(Holder.Level));
row("a namespace, in its block", () => Holder.nestedValue());
row("a namespace, from outside", () => Holder.Nested.value);
row("a variable of the nested namespace", () => nested.read());

namespace Split { export namespace Part { export const a = 1; } export enum Kind { A = "a" } }
const firstPart = Split.Part;
const firstKind = Split.Kind;
(Split as any).Part = { stored: true };
(Split as any).Kind = { stored: true };
namespace Split { export namespace Part { export const b = 2; } export enum Kind { B = "b" } }
row("a later block extends the property", () => keys(Split.Part) + " " + keys(Split.Kind));
row("and not the first object", () => keys(firstPart) + " " + keys(firstKind));

namespace Outer.Middle.Inner { export const leaf = 1; }
namespace Outer.Middle { export const branch = 2; }
row("dotted names", () => [keys(Outer), keys(Outer.Middle), keys(Outer.Middle.Inner)].join(" "));
