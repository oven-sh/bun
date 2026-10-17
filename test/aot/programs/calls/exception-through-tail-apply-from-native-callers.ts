// A strict compiled function that ends in `g.apply(thisArg, list)`, where `list` is neither an array nor `arguments`, calls `g` through C++
// and a nested VM entry. These rows throw out of that call, from `g` or from reading the list, with every kind of caller that is
// not compiled code: run-time generated code, a promise reaction, a bound function, a Proxy trap, a sort comparator, a JSON reviver.
function row(name: string, run: () => unknown) { try { console.log(name + ": " + String(run())); } catch (e) { console.log(name + ": caught " + (e as Error).message); } }
const interpretedThrower = new Function("a", "throw new TypeError('thrown ' + a);");
function compiledThrower(a: unknown): unknown { throw new TypeError("thrown " + a); }
function deepThrower(a: unknown): unknown { return [1].map(() => compiledThrower(a))[0]; }
const call = new Function("f", "x", "return f(x);");
const arrayLike = () => ({ length: 1, 0: "a" });

const throwers: Record<string, (a: unknown) => unknown> = { interpretedThrower: interpretedThrower as (a: unknown) => unknown, compiledThrower, deepThrower };
for (const [name, thrower] of Object.entries(throwers)) {
  function viaApply(list: unknown): unknown { return thrower.apply(undefined, list as any); }
  const arrow = (list: unknown): unknown => thrower.apply(undefined, list as any);
  const holder = { method(list: unknown): unknown { return thrower.apply(this, list as any); } };
  row(name + ", an array-like", () => call(viaApply, arrayLike()));
  row(name + ", a typed array", () => call(viaApply, new Uint8Array([7])));
  row(name + ", a string object", () => call(viaApply, new String("s")));
  row(name + ", an arrow function", () => call(arrow, arrayLike()));
  row(name + ", a method", () => call(holder.method, arrayLike()));
  row(name + ", a bound function", () => call(viaApply.bind(null), arrayLike()));
  row(name + ", Reflect.apply", () => Reflect.apply(viaApply, undefined, [arrayLike()]));
  row(name + ", a Proxy trap", () => call(new Proxy(viaApply, { apply(target, self, list) { return Reflect.apply(target, self, list); } }), arrayLike()));
  row(name + ", a sort comparator", () => [2, 1].sort((a, _b) => thrower.apply(undefined, { length: 1, 0: a } as any) as number));
  row(name + ", a JSON reviver", () => JSON.parse("[1]", (_key, value) => thrower.apply(undefined, { length: 1, 0: value } as any)));
  row(name + ", a replace callback", () => "x".replace("x", text => thrower.apply(undefined, { length: 1, 0: text } as any) as string));
}

function applies(list: unknown): unknown { return compiledThrower.apply(undefined, list as any); }
row("the length throws", () => call(applies, { get length() { throw new RangeError("length refused"); } }));
row("an element throws", () => call(applies, { length: 1, get 0() { throw new RangeError("element refused"); } }));
row("Reflect.apply in run-time code", () => new Function("return Reflect.apply(function (a) { throw new TypeError('thrown ' + a); }, undefined, { length: 1, 0: 'a' });")());
row("Reflect.apply in run-time code, caught there", () => new Function("try { return Reflect.apply(function (a) { throw new TypeError('thrown ' + a); }, undefined, { length: 1, 0: 'a' }); } catch (e) { return 'inside ' + e.message; }")());

async function asyncApplies(list: unknown): Promise<unknown> { return interpretedThrower.apply(undefined, list as any); }
await Promise.resolve(arrayLike()).then(applies).catch(e => console.log("a promise reaction: rejected " + e.message));
await (call(asyncApplies, arrayLike()) as Promise<unknown>).then(v => console.log(v), e => console.log("an async function: rejected " + e.message));
await Promise.resolve().then(() => row("inside a promise reaction", () => call(applies, arrayLike())));
console.log([1.5, 2.5].map(x => x * 2).join(), "text".toUpperCase(), 2 ** 31);
