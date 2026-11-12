// What a name inside `with` is goes by the object first: no test of the name is decided by the variable outside.
var top = { a: 1 };
with ({ top: 0 }) {
  console.log(typeof top, top ? "truthy" : "falsy", !top, top || "or", top && "and");
  if (top) console.log("wrong");
  else console.log("right");
}
function typed(scope) {
  const o = { a: 1 };
  with (scope) return typeof o;
}
function tested(scope) {
  const o = { a: 1 };
  with (scope) return o ? "truthy" : "falsy";
}
function negated(scope) {
  const list = [];
  with (scope) return !list;
}
function alternative(scope) {
  const o = {};
  with (scope) return (o || "or") === "or";
}
function branched(scope) {
  const o = { a: 1 };
  with (scope) {
    if (o) return "yes";
  }
  return "no";
}
function field(scope) {
  const box = { inner: {} };
  with (scope) return typeof box.inner + (box.inner ? 1 : 2) + !box.inner;
}
function functions(scope) {
  const fn = () => 1;
  with (scope) return typeof fn + (fn ? 1 : 2);
}
function render(scope) {
  const defaults = { title: "none" };
  let text = "";
  with (scope) {
    text += typeof defaults;
    if (defaults) text += ":" + defaults.title;
  }
  return text;
}
function nested(scope) {
  const o = { a: 1 };
  with ({}) {
    with (scope) return typeof o + (o ? 1 : 2);
  }
}
function changed(scope) {
  const o = { a: 1 };
  with (scope) {
    const before = typeof o;
    delete scope.o;
    const between = typeof o;
    scope.o = null;
    return [before, between, typeof o, o ? 1 : 2].join();
  }
}
function* steps(scope) {
  const o = { a: 1 };
  with (scope) {
    yield typeof o;
    yield !o;
    scope.o = 1n;
    yield typeof o;
  }
}
function looped(scopes) {
  const o = { a: 1 };
  const answers = [];
  for (const scope of scopes) with (scope) answers.push(typeof o, o ? 1 : 2);
  return answers.join();
}
function caught(scope) {
  const o = { a: 1 };
  try {
    throw scope;
  } catch (error) {
    with (error) return typeof o + !o;
  }
}
function declared(text) {
  const o = { a: 1 };
  return (function () {
    eval(text);
    return typeof o + (o ? 1 : 2);
  })();
}
const unscopables = { o: 0, list: 0, box: 0, fn: 0, defaults: 0, [Symbol.unscopables]: { o: true, list: true, box: true, fn: true, defaults: true } };
let asked = 0;
const proxy = () => new Proxy({}, { has: (target, name) => typeof name === "string" && /^(o|list|box|fn|defaults)$/.test(name), get: (target, name) => (name === Symbol.unscopables ? undefined : asked++ % 2 ? 0 : { inner: 0, title: 1 }) });
const scopes = [
  () => ({ o: 0, list: 0, box: { inner: 0 }, fn: 0, defaults: 0 }),
  () => ({ o: null, list: null, box: {}, fn: null, defaults: null }),
  () => ({ o: undefined, list: undefined, box: { inner: "" }, fn: undefined, defaults: undefined }),
  () => ({}),
  () => ({ o: "text", list: 1, box: { inner: 1 }, fn: class {}, defaults: { title: "given" } }),
  () => Object.create({ o: "", list: "", box: { inner: null }, fn: "", defaults: "" }),
  () => ({ get o() { return 0; }, get list() { return 0; }, get box() { return { inner: 0 }; }, get fn() { return 0; }, get defaults() { return 0; } }),
  () => unscopables,
  proxy,
];
for (const scope of scopes) {
  const answers = [typed, tested, negated, alternative, branched, field, functions, render, nested, caught].map(f => String(f(scope())));
  console.log(answers.join(" "), [...steps({ ...scope() })].join(), scope === scopes[7] ? "" : changed({ ...scope() }));
}
console.log(looped([{ o: 0 }, {}, { o: undefined }, { o: () => 1 }]), declared("var o = 0"), declared("1"), declared("function o() {}"));
