// A function behind 200,000 proxies without an apply trap. A handler without a prototype is asked at every call, so each proxy hands the call on to its target and waits for the answer,
// and the call needs more stack than there is: a RangeError, however the call is made and whatever stands at the end of the chain.
function behindProxies(target) {
  let chain = target;
  for (let i = 0; i < 200000; i++) chain = new Proxy(chain, Object.create(null));
  return chain;
}

function report(label, run) {
  try {
    console.log(label + ":", "answers", run());
  } catch (error) {
    console.log(label + ":", error instanceof RangeError ? "RangeError" : String(error));
  }
}

const chain = behindProxies(function () { return 1; });
const list = [1, 2, 3];
const tailCall = () => { "use strict"; return chain(); };
const revocable = Proxy.revocable(function () {}, {});
const revoked = behindProxies(revocable.proxy);
revocable.revoke();

report("called", () => chain());
report("with arguments", () => chain(1, 2, 3));
report("with more arguments than there are registers", () => chain(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12));
report("with a list", () => chain(...list));
report("as a method", () => ({ method: chain }).method());
report("as a tag", () => chain`text`);
report("as the last step of a function", () => tailCall());
report("as a callback of map", () => [1].map(chain));
report("as a comparator", () => [2, 1].sort(chain));
report("as a replacer", () => "a".replace("a", chain));
report("as a getter", () => Object.defineProperty({}, "value", { get: chain }).value);
report("as a setter", () => { Object.defineProperty({}, "value", { set: chain }).value = 1; });
report("as toString", () => `${{ toString: chain }}`);
report("as the next of an iterator", () => [...{ [Symbol.iterator]: () => ({ next: chain }) }]);
report("by call", () => chain.call(null));
report("by apply", () => chain.apply(null, list));
report("by Reflect.apply", () => Reflect.apply(chain, null, list));
report("bound", () => chain.bind(null)());
report("constructed", () => new chain());
report("over a native function", () => behindProxies(Math.abs)(-1));
report("over a bound function", () => behindProxies((function () {}).bind(null))());
report("over a class", () => behindProxies(class {})());
report("over a revoked proxy", () => revoked());

try {
  console.log("as a reaction:", "answers", await Promise.resolve(0).then(chain));
} catch (error) {
  console.log("as a reaction:", error instanceof RangeError ? "RangeError" : String(error));
}

let short = function () { return "the function"; };
for (let i = 0; i < 100; i++) short = new Proxy(short, {});
report("through a hundred, afterward", () => short());
