// A callee that only calls a closure and reads its members can still walk off with the closure: `f.prototype.constructor` is f, a property of the function object may hold anything, a bound function and a Proxy hold their target, and the closure may hand itself out when it is called.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
function keepsThePrototype(f, i) {
  if (i % 80 === 79) kept.push(f.prototype);
  return f(i);
}
function readsNameAndLength(f) {
  return f.name + "/" + f.length + "/" + typeof f.prototype + "/" + f.toString().length;
}
function tags(f, i) {
  f.tag = { text: "tag" + i };
  f.calls = (f.calls || 0) + 1;
  return f(i);
}
function keepsTheTag(f, i) {
  if (i % 80 === 78) kept.push(f.note);
  return f(i);
}
function constructs(F, i) {
  const made = new F(i);
  if (i % 80 === 77) kept.push(made);
  return made.n;
}
function asksForItsOwner(f, i) {
  const answer = f(i);
  if (i % 80 === 76) kept.push(answer);
  return typeof answer;
}
function callsAsAMethod(f, i) {
  const host = { f, tag: "host" + i };
  return host.f(i);
}
let total = 0;
let text = "";
for (let i = 0; i < 240; i++) {
  const captured = { tag: "captured" + i };
  total += keepsThePrototype(function (x) {
    return captured.tag.length + x;
  }, i);
  text = readsNameAndLength(function named(a, b) {
    return captured;
  });
  const tagged = x => captured.tag.length + x;
  total += tags(tagged, i) + tags(tagged, i) + tagged.calls + tagged.tag.text.length;
  const noted = x => x;
  noted.note = { owner: noted, tag: "note" + i, captured };
  total += keepsTheTag(noted, i);
  total += constructs(function Made(n) {
    this.n = n;
    this.from = captured;
  }, i);
  text += asksForItsOwner(function me() {
    return me;
  }, i);
  text += asksForItsOwner(() => captured, i);
  total += callsAsAMethod(function (x) {
    if (x % 80 === 75) kept.push(this);
    return x;
  }, i);
}
console.log(total, text, churn(80), kept.length);
for (const k of kept) {
  if (typeof k === "function") console.log("a function that answers itself:", k() === k);
  else if (k.owner) console.log("a note:", k.tag, k.owner(5), k.owner.note === k, k.captured.tag);
  else if (k.from) console.log("an instance:", k.n, k.from.tag, k.constructor.name, new k.constructor(1).from === k.from);
  else if (k.f) console.log("a host:", k.tag, k.f(1));
  else if (k.tag) console.log("a captured object:", k.tag);
  else console.log("a prototype:", typeof k.constructor, k.constructor(1), Object.getPrototypeOf(new k.constructor(1)) === k);
}

// Bound functions and proxies hold the closure.
kept.length = 0;
function binds(f, i) {
  const b = f.bind(null, i);
  if (i % 80 === 79) kept.push(b);
  return b();
}
function bindsTwice(f, i) {
  const b = f.bind(null).bind(null, i);
  if (i % 80 === 78) kept.push(b);
  return b();
}
function proxies(f, i) {
  const p = new Proxy(f, {});
  if (i % 80 === 77) kept.push(p);
  return p(i);
}
function bindsCall(f, i) {
  const c = Function.prototype.call.bind(f, null);
  if (i % 80 === 76) kept.push(c);
  return c(i);
}
function asAGetter(f, i) {
  const host = Object.defineProperty({}, "value", { get: f });
  if (i % 80 === 75) kept.push(() => host.value);
  return host.value;
}
function asToString(f, i) {
  const host = { toString: f };
  if (i % 80 === 74) kept.push(() => `${host}`);
  return `${host}`.length;
}
total = 0;
for (let i = 0; i < 160; i++) {
  const captured = { n: i };
  const f = x => captured.n * 2 + (x === undefined ? 0 : 1);
  total += binds(f, i) + bindsTwice(f, i) + proxies(f, i) + bindsCall(f, i) + asAGetter(f, i) + asToString(() => "n" + captured.n, i);
  captured.n++;
}
console.log(total, churn(80), kept.map(k => k(0)).join());

// A class made in a loop: its methods, its statics and its instances all lead back to it and to what it closed over.
kept.length = 0;
function usesAClass(C, i) {
  const instance = new C();
  if (i % 80 === 79) kept.push(instance.method);
  if (i % 80 === 78) kept.push(instance);
  if (i % 80 === 77) kept.push(C.prototype);
  return instance.method();
}
total = 0;
for (let i = 0; i < 160; i++) {
  const captured = { n: i };
  total += usesAClass(
    class {
      method() {
        return captured.n;
      }
    },
    i,
  );
}
console.log(total, churn(80), kept.map(k => (typeof k === "function" ? k() : k.method())).join());
