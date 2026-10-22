// All that the callers below know of `f` is that it is a function. What `f.call`, `f.apply`, `f.bind`, `f.toString`, `f.constructor`, `f.hasOwnProperty` and `instanceof f` find
// depends on the properties the function has got since it was made and on its prototype: a name of its own that hides nothing changes nothing, one that hides a member does.
const outside: any = JSON.parse('{"one":1}');
const lines: string[] = [];
const receiver: any = { tag: "receiver" };

function say(run: () => unknown): string {
  try {
    const value = run();
    return typeof value === "function" ? "function " + (value as any).name : String(value);
  } catch (error: any) {
    return error.constructor.name;
  }
}

function viaCall(f: any, v: number): unknown { if (typeof f === "function") return f.call(receiver, v); return "no function"; }
function viaApply(f: any, v: number): unknown { if (typeof f === "function") return f.apply(receiver, [v]); return "no function"; }
function viaBind(f: any, v: number): unknown { if (typeof f === "function") { const bound = f.bind(receiver, v); return typeof bound === "function" ? bound.name + "/" + bound.length + "/" + say(() => bound()) : bound; } return "no function"; }
function viaTyped(f: Function, v: number): unknown { return f.call(receiver, v); }
function viaCallback(f: (this: any, v: number) => unknown, v: number): unknown { return f.call(receiver, v); }
function others(f: any): string {
  if (typeof f !== "function") return "no function";
  return [say(() => typeof f.toString()), say(() => f.constructor), say(() => f.hasOwnProperty("tag")), say(() => f.isPrototypeOf(receiver)), say(() => typeof f.valueOf()), say(() => receiver instanceof f)].join(" ");
}
function ask(label: string, f: any): void {
  lines.push(label + ": " + [say(() => viaCall(f, 1)), say(() => viaApply(f, 2)), say(() => viaBind(f, 3)), say(() => viaTyped(f, 4)), say(() => viaCallback(f, 5)), others(f)].join(" | "));
}
// Nobody can say which function comes back.
function lose(f: any): any { outside.held = f; return outside.held; }
function make(): any { return lose(function made(this: any, v: number) { return (this === undefined || this === null ? "none" : this.tag) + ":" + v; }); }
const mine = function (this: any, ...rest: unknown[]) { return "mine(" + typeof this + "," + rest.length + ")"; };

ask("as it was made", make());

let f = make(); f.version = 1; ask("a name that hides nothing", f);
f = make(); f.version = 1; f.other = 2; f.third = f; ask("three names that hide nothing", f);
f = make(); void f.prototype; ask("its prototype property was read", f);
f = make(); new f(1); f.version = 1; ask("constructed, then a name", f);
f = make(); f.prototype.method = mine; f.create = mine; ask("a method and a static", f);
f = make(); void f.name; void f.length; ask("name and length were read", f);

for (const name of ["call", "apply", "bind", "toString", "constructor", "hasOwnProperty", "isPrototypeOf", "valueOf"]) {
  f = make(); f[name] = mine; ask("its own " + name, f);
  f = make(); f.version = 1; f[name] = mine; ask("a name, then its own " + name, f);
  f = make(); Object.defineProperty(f, name, { get() { return mine; }, configurable: true }); ask("a getter under " + name, f);
  f = make(); Object.defineProperty(f, name, { value: undefined, configurable: true }); ask("undefined under " + name, f);
  f = make(); f[name] = mine; delete f[name]; ask("its own " + name + ", deleted again", f);
}

f = make(); ask("before it hides call", f); f.call = mine; ask("after it hides call", f); delete f.call; ask("after call was deleted", f);
f = make(); f.version = 1; ask("with a name, before it hides apply", f); f.apply = mine; ask("with a name, after it hides apply", f);

f = make(); Object.defineProperty(f, Symbol.hasInstance, { value: () => true }); ask("its own Symbol.hasInstance", f);
f = make(); f[Symbol.iterator] = mine; f[Symbol("private")] = 1; ask("two symbols", f);
f = make(); f[0] = "zero"; f[1] = "one"; ask("two indices", f);
f = make(); f.then = mine; f.toJSON = mine; ask("then and toJSON", f);

f = make(); Object.defineProperty(f, "name", { value: "renamed" }); ask("another name", f);
f = make(); Object.defineProperty(f, "length", { value: 7 }); ask("another length", f);
f = make(); f.version = 1; Object.defineProperty(f, "name", { value: "renamed" }); Object.defineProperty(f, "length", { value: 7 }); ask("a static, another name and length", f);
f = make(); delete f.name; delete f.length; ask("name and length deleted", f);
f = make(); Object.defineProperty(f, "name", { get() { return "computed"; } }); ask("a getter under name", f);

f = make(); Object.setPrototypeOf(f, { call: mine, apply: mine, bind: mine }); ask("another prototype with the three", f);
f = make(); Object.setPrototypeOf(f, null); ask("no prototype", f);
f = make(); Object.setPrototypeOf(f, Object.create(Function.prototype, { call: { value: mine } })); ask("a prototype between, which hides call", f);
f = make(); Object.setPrototypeOf(f, Object.create(Function.prototype)); ask("a prototype between, which hides nothing", f);
f = make(); Object.setPrototypeOf(f, null); Object.setPrototypeOf(f, Function.prototype); ask("its prototype taken and given back", f);
f = make(); f.version = 1; f.__proto__ = { call: mine }; ask("a static, then __proto__", f);
f = make(); Object.setPrototypeOf(f, make()); ask("below another function", f);
{ const above = make(); above.call = mine; f = make(); Object.setPrototypeOf(f, above); ask("below a function that hides call", f); }

f = make(); Object.preventExtensions(f); ask("takes no more", f);
f = make(); f.version = 1; Object.seal(f); ask("sealed", f);
f = make(); f.version = 1; Object.freeze(f); ask("frozen", f);
f = make(); f.call = mine; Object.freeze(f); ask("hides call, frozen", f);
f = make(); Object.create(f); f.version = 1; ask("is a prototype", f);
{ const heir = Object.create(make()); lines.push("an object below a function: " + say(() => heir.call(receiver, 1)) + " " + say(() => viaCall(heir, 1))); }

class Plain { static tag = "class"; static call(...rest: unknown[]) { return "static call " + rest.length; } }
class Below extends Plain {}
class Bare { constructor(public v?: number) {} }
ask("a class with a static call", lose(Plain));
ask("a class below it", lose(Below));
ask("a class without statics", lose(Bare));
ask("an arrow function", lose((v: number) => "arrow:" + v));
ask("a method", lose({ method(this: any, v: number) { return this.tag + ":" + v; } }.method));
ask("an async function", lose(async function (this: any, v: number) { return v; }));
ask("a generator function", lose(function* (this: any, v: number) { yield v; }));
ask("a bound function", lose(make().bind({ tag: "bound" })));
{ const bound = make().bind({ tag: "bound" }); bound.call = mine; ask("a bound function that hides call", lose(bound)); }
{ const bound = make().bind({ tag: "bound" }); bound.version = 1; ask("a bound function with a name", lose(bound)); }
ask("a function of the engine", lose(Math.max));
ask("a constructor of the engine", lose(Map));
ask("a proxy", lose(new Proxy(make(), {})));
ask("a proxy that answers for call", lose(new Proxy(make(), { get(target, key) { return key === "call" ? mine : (target as any)[key]; } })));
ask("no function", lose({ call: mine }));

// One function, one caller, and the function changes between two turns of the loop.
{
  const changing = make();
  const seen: string[] = [];
  for (let turn = 0; turn < 8; ++turn) {
    if (turn === 2) changing.version = 1;
    if (turn === 4) changing.call = mine;
    if (turn === 6) delete changing.call;
    seen.push(say(() => viaCall(changing, turn)));
  }
  lines.push("as it changes: " + seen.join(" "));
}
console.log(lines.join("\n"));
