// A closure that is never called loses its body. What had been inlined into it read globals (Error, Object, Array), and the compiler still looked at those reads.
class OutOfFuel extends Error {}
class Box<T> {
  constructor(public value: T) {}
}
function describeError(error: unknown): string {
  return typeof error + " " + String(error);
}
function inspect(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value instanceof Error) return describeError(value);
  const flags = (Object.isFrozen(value) ? "F" : Object.isSealed(value) ? "S" : Object.isExtensible(value) ? "" : "N");
  const parts: string[] = [];
  const proto = Object.getPrototypeOf(value);
  const name = Array.isArray(value) ? "[]" : proto === null ? "null" : proto === Object.prototype ? "" : typeof proto.constructor === "function" ? proto.constructor.name : "?";
  return name + flags + "{" + parts.join(",") + "}";
}
function say(label: string, make: () => string): void {
}
type T11 = { readonly kind: "line"; items: boolean; };
const fn31 = (p0: number, p1: Box<T11>, p2: string, p3: Box<string>[]): number => {
  const seen: string[] = [];
  seen.push(inspect(p2));
  return (-(~~p0));
};
say("e1", (): string => {
  const seen: string[] = [];
  for (let i50 = -2; i50 < 3; i50++) {
    if (Boolean(fn31(i50, new Box<T11>({ kind: "line", items: true }), "", []))) {
    }
  }
  try {
  } catch (error54) {
  }
  return seen.join(";");
});
console.log("built and ran");
