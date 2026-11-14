const log = [];
async function same(x) { return x; }
function beside(name) {
  let chain = Promise.resolve();
  for (let step = 1; step <= 5; step++) chain = chain.then(() => log.push(name + step));
  return chain;
}
async function asks(name, value) {
  log.push(name + " starts");
  const given = await same(value);
  log.push(name + " got " + (typeof given === "object" && given !== null ? Object.keys(given).join("+") || "empty" : String(given)));
  return given;
}
class Inherits { then(resolve) { log.push("inherited then runs"); resolve("from the class"); } }
const cases = () => [
  ["undefined", undefined],
  ["null", null],
  ["number", 7],
  ["fraction", 0.5],
  ["text", "text"],
  ["symbol", Symbol.iterator],
  ["bigint", 12n],
  ["plain", { a: 1, b: 2 }],
  ["list", [1, 2]],
  ["function", function named() {}],
  ["own then", { then(resolve) { log.push("own then runs"); resolve("from the object"); } }],
  ["then that is no function", { then: 5 }],
  ["inherited", new Inherits()],
  ["promise", Promise.resolve("from a promise")],
  ["late promise", new Promise(resolve => setTimeout(resolve, 1, "late"))],
  ["without prototype", Object.create(null)],
  ["proxy", new Proxy({}, { get(target, key) { if (key === "then") log.push("the proxy is asked for then"); return undefined; } })],
];
async function round(title) {
  log.push("== " + title);
  for (const [name, value] of cases()) {
    const other = beside(name + ":");
    await Promise.all([asks(name, value), other]);
  }
}
await round("as born");
class Late { constructor() { this.kept = 1; } }
const seen = new Late();
log.push("it gave " + String(Object.keys(await asks("an instance of a class without then", seen))));
Late.prototype.then = function (resolve) { log.push("then of the class runs"); resolve("from the class, late"); };
log.push("it gave " + String(await asks("the same instance under a then on its class", seen)));
log.push("it gave " + String(await asks("a new instance under a then on its class", new Late())));
delete Late.prototype.then;
log.push("it gave " + String(Object.keys(await asks("the same instance with the then gone", seen))));
await round("behind the then on the class");
console.log(log.join("\n"));
