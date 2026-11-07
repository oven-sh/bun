// A function behind 200,000 proxies whose handlers are ordinary empty objects. The call needs more stack than there is: a RangeError, seven times in a row and however the call is made.
// A proxy may remember that its handler has no apply trap, and a call passes over those that do, so a later call comes further down the chain and in the end one returns.
function behindProxies(target) {
  let chain = target;
  for (let i = 0; i < 200000; i++) chain = new Proxy(chain, {});
  return chain;
}

function report(label, call) {
  try {
    call();
    console.log(label, "no error");
  } catch (error) {
    console.log(label, error instanceof RangeError ? "RangeError" : String(error));
  }
}

const chain = behindProxies(function () {});
report("called", () => chain());
report("called with arguments", () => chain(1, 2, 3));
report("as a method", () => ({ method: chain }).method());
report("as a callback", () => [1].map(chain));
report("by call", () => chain.call(null));
report("by Reflect.apply", () => Reflect.apply(chain, null, []));
report("constructed", () => new chain());

function countCallsUntilOneReturns(call) {
  for (let count = 1; count <= 400; count++) {
    try {
      call();
      return count;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return Infinity;
}

const ways = {
  "called": chain => chain(),
  "with a list": chain => chain(...[1, 2]),
  "as the last step of a function": chain =>
    (() => {
      "use strict";
      return chain();
    })(),
  "by apply": chain => chain.apply(null, []),
};
for (const [label, call] of Object.entries(ways)) {
  const chain = behindProxies(function () {});
  const count = countCallsUntilOneReturns(() => call(chain));
  console.log(
    label,
    count > 7 ? "takes more than seven calls" : "takes " + count,
    count <= 400 ? "and returns in the end" : "and never returns",
  );
}
