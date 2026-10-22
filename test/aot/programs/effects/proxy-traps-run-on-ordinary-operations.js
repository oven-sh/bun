// An operation on a proxy, by syntax or inside a built-in, calls a trap of the handler: each line goes wrong if a read of a counter moves across the operation.
let traps = 0;
const handler = {
  get(target, key, receiver) {
    traps++;
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    traps++;
    return Reflect.set(target, key, value, receiver);
  },
  has(target, key) {
    traps++;
    return Reflect.has(target, key);
  },
  deleteProperty(target, key) {
    traps++;
    return Reflect.deleteProperty(target, key);
  },
  ownKeys(target) {
    traps++;
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, key) {
    traps++;
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
  getPrototypeOf(target) {
    traps++;
    return Reflect.getPrototypeOf(target);
  },
};
const proxy = new Proxy({ a: 1, b: 2 }, handler);
function bySyntax() {
  traps = 0;
  const a = proxy.a;
  const afterGet = traps;
  proxy.c = 3;
  const afterSet = traps;
  const has = "a" in proxy;
  const afterHas = traps;
  delete proxy.c;
  return [a, afterGet, afterSet, has, afterHas, traps];
}
function keys() {
  traps = 0;
  const names = Object.keys(proxy);
  return [names.length, traps];
}
function assign() {
  traps = 0;
  const copy = Object.assign({}, proxy);
  return [copy.b, traps];
}
function spread() {
  traps = 0;
  const copy = { ...proxy };
  return [copy.a, traps];
}
function stringify() {
  traps = 0;
  const text = JSON.stringify(proxy);
  return [text, traps];
}
function instance() {
  traps = 0;
  const answer = proxy instanceof Object;
  return [answer, traps];
}
function loop() {
  traps = 0;
  let names = "";
  for (const name in proxy) names += name;
  return [names, traps > 0];
}
let applied = 0;
const callable = new Proxy(function () {}, {
  apply() {
    applied++;
    return 1;
  },
  construct() {
    applied += 10;
    return {};
  },
});
function callAndConstruct() {
  applied = 0;
  callable();
  const afterCall = applied;
  new callable();
  const afterConstruct = applied;
  [1].forEach(callable);
  return [afterCall, afterConstruct, applied];
}
console.log(bySyntax(), keys(), assign(), spread());
console.log(stringify(), instance(), loop(), callAndConstruct());
