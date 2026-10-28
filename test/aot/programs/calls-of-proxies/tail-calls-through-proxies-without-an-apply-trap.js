// Two functions call each other in tail position 150,000 times, each through a Proxy of the other whose handler has no apply trap: an empty handler, one with other traps,
// and a Proxy of a Proxy. No frame stays behind. The output is that of plain Bun.
"use strict";
function chain(makeHandler, wrap) {
  function even(n, sum) {
    if (n <= 0) return "even " + sum + " " + typeof this;
    return proxyOfOdd(n - 1, sum + 1);
  }
  function odd(n, sum) {
    if (n <= 0) return "odd " + sum + " " + typeof this;
    return proxyOfEven.call(sum, n - 1, sum + 1);
  }
  const proxyOfOdd = wrap(new Proxy(odd, makeHandler()));
  const proxyOfEven = wrap(new Proxy(even, makeHandler()));
  return even(150000, 0) + " | " + proxyOfOdd(150001, 0);
}
const same = proxy => proxy;
console.log(chain(() => ({}), same));
console.log(chain(() => ({ get: Reflect.get, has: Reflect.has }), same));
console.log(chain(() => ({}), proxy => new Proxy(proxy, {})));
