// `value instanceof bound` goes on to the function that was bound: it reads Symbol.hasInstance of that function, calls what it finds with that function as `this`, and without a method of its own reads `prototype` of it.
// Each test here is also given a constructor that the build cannot name. Every getter and method that answers runs, so each is part of the executable.
const show = (label, run) => { try { console.log(label, ...run()); } catch (e) { console.log(label, "threw", String(e).slice(0, 70)); } };
const boundProxy = new Proxy(() => {}, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } }).bind();
{
  const ask = (value, ctor) => value instanceof ctor;
  let calls = 0;
  const D = () => {};
  Object.defineProperty(D, Symbol.hasInstance, { value(value) { calls++; return value === 1; } });
  const thrice = D.bind().bind(null, 1).bind();
  show("bound three times", () => [ask(1, thrice), ask(2, thrice), calls]);
  show("beside it", () => [ask(1, boundProxy)]);
}
{
  const ask = (value, ctor) => value instanceof ctor;
  let calls = 0;
  const D = () => {};
  Object.defineProperty(D, Symbol.hasInstance, { get() { calls++; return function answer(value) { calls += 10; return value === 1 && this === D; }; } });
  const boundD = D.bind();
  show("the method comes out of a getter", () => [ask(1, boundD), ask(2, boundD), calls]);
  show("beside it", () => [ask(1, boundProxy)]);
}
{
  const ask = (value, ctor) => value instanceof ctor;
  let calls = 0;
  class Base {}
  const D = () => {};
  Object.defineProperty(D, "prototype", { get() { calls++; return Base.prototype; } });
  const boundD = D.bind();
  show("prototype comes out of a getter", () => [ask(new Base(), boundD), ask({}, boundD), calls]);
  show("beside it", () => [ask(1, boundProxy)]);
}
{
  const ask = (value, ctor) => value instanceof ctor;
  let seen = "";
  const D = () => {};
  D.wanted = "a";
  Object.defineProperty(D, Symbol.hasInstance, { value(value) { seen += value.tag; return value.tag === this.wanted; } });
  const boundD = D.bind();
  show("the method reads what is tested", () => [ask({ tag: "a" }, boundD), ask({ tag: "b" }, boundD), seen]);
  show("beside it", () => [ask(1, boundProxy)]);
}
{
  const ask = (value, ctor) => value instanceof ctor;
  let calls = 0;
  const D = () => {};
  Object.defineProperty(D, Symbol.hasInstance, { value(value) { calls++; return value === 1; } });
  const boundD = D.bind();
  show("beside a constructor read under a computed name", () => [ask(1, boundD), ask(2, boundD), calls]);
  const other = Reflect.get(globalThis, ["Ob", "ject"].join(""));
  show("beside it", () => [ask({}, other), ask(1, other)]);
}
