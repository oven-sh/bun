// Functions that end in `return f()` are used with `new`, `Reflect.construct` and plain calls: a result that is no object is replaced by the new object.
const opaque = <T,>(x: T): T => (globalThis as any).nothingHere ? (undefined as any) : x;
function one() { return 1; }
function str() { return "s"; }
function obj() { return { made: "by obj" }; }
function undef() {}
function TailPrimitive() { return one(); }
function TailString() { return str(); }
function TailObject() { return obj(); }
function TailUndefined() { return undef(); }
function TailUnknown(f: any) { return f(); }
function TailNative(x: any) { return Math.abs(x); }
function Primitive() { return 5; }
const show = (v: unknown) => typeof v + ":" + JSON.stringify(v) + ":" + (v && typeof v === "object" ? Object.getPrototypeOf(v) === Object.prototype ? "plain" : (Object.getPrototypeOf(v) as any).constructor.name : "-");
for (const F of [TailPrimitive, TailString, TailObject, TailUndefined, Primitive] as any[]) {
  console.log(F.name, "new:", show(new F()), "| Reflect.construct:", show(Reflect.construct(F, [])), "| opaque:", show(new (opaque(F))()), "| called:", show(F()));
}
console.log("TailUnknown", show(new (TailUnknown as any)(one)), show(new (TailUnknown as any)(obj)), show(Reflect.construct(TailUnknown, [str])), show(new (opaque(TailUnknown) as any)(undef)));
console.log("TailNative", show(new (TailNative as any)(-3)), show(Reflect.construct(TailNative, [-3])));
for (let i = 0; i < 3; i++) console.log("in a loop", show(new (TailPrimitive as any)()), show(new (TailUnknown as any)(i & 1 ? one : obj)));
class Base { constructor() { return one() as any; } }
class Derived extends Base { x = 1; }
console.log("class", show(new Base()), show(new Derived()));
