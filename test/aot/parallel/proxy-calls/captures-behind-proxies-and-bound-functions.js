// A closure that holds a capture, called through what stands in front of it: a proxy without an apply trap, a chain of them, a bound function, a proxy over a bound function, a bound function over a proxy.
// Whoever follows the call knows which function is entered in the end. What is called holds none of what that function has captured, and is not the function object that the function finds under its own name.
function say(label, ...values) {
  console.log(label + ": " + values.map(String).join(" "));
}

function outcome(run) {
  try {
    return run();
  } catch (error) {
    return error instanceof RangeError ? "RangeError" : error instanceof TypeError ? "TypeError" : "threw " + String(error);
  }
}

const adds = (base) => (x) => base + x;

function behind(target, depth, makeHandler) {
  let chain = target;
  for (let i = 0; i < depth; i++) chain = new Proxy(chain, makeHandler());
  return chain;
}

const plain = () => ({});
const bare = () => Object.create(null);

say("one proxy", behind(adds(1), 1, plain)(10), behind(adds(2), 1, bare)(10));
say("three proxies", behind(adds(3), 3, plain)(10), behind(adds(4), 3, bare)(10));
say("bound", adds(5).bind(null)(10), adds(6).bind(null, 20)(), adds(7).bind(null).bind(null, 30)());
say("proxies over bound", behind(adds(8).bind(null), 2, plain)(10), behind(adds(9).bind(null, 40), 2, bare)());
say("bound over proxies", behind(adds(10), 2, plain).bind(null)(10), behind(adds(11), 2, bare).bind(null, 50)());

function callIt(callee, x) {
  return callee(x);
}
const all = [adds(12), new Proxy(adds(13), {}), adds(14).bind(null), new Proxy(adds(15).bind(null), {}), new Proxy(adds(16), {}).bind(null)];
say("one call for all", ...all.map((callee) => callIt(callee, 100)));

function sum(callee) {
  let total = 0;
  for (let i = 0; i < 1000; i++) total = callee(total) | 0;
  return total;
}
say("in a loop", sum(adds(1)), sum(new Proxy(adds(2), {})), sum(adds(3).bind(null)), sum(behind(adds(4).bind(null), 2, plain)), sum(behind(adds(5), 2, bare).bind(null)));

const names = (tag) => function self(ask) { return ask ? self : tag; };
const named = names("tag");
const namedProxy = new Proxy(named, {});
const namedBound = named.bind(null);
say("its own name behind a proxy", namedProxy(true) === named, namedProxy(true) === namedProxy, namedProxy(false));
say("its own name behind a bind", namedBound(true) === named, namedBound(true) === namedBound, namedBound(false));
say("its own name behind both", behind(namedBound, 2, plain)(true) === named, behind(named, 2, bare).bind(null)(false));

const counts = (step) => function count(n) { return n <= 0 ? 0 : step + count(n - 1); };
say("calls itself", new Proxy(counts(2), {})(5), counts(3).bind(null)(5), behind(counts(4).bind(null, 5), 2, plain)());

const handler = {};
const watched = new Proxy(adds(17), handler);
const before = callIt(watched, 1);
handler.apply = (target, self, list) => "trapped " + target(...list);
const during = callIt(watched, 1);
delete handler.apply;
say("a trap that comes and goes", before, during, callIt(watched, 1));

const above = {};
const inherits = new Proxy(adds(18), Object.create(above));
const withoutTrap = inherits(1);
above.apply = () => "from above";
say("a trap that the handler inherits", withoutTrap, inherits(1));

const revocable = Proxy.revocable(adds(19), {});
const whileItLives = callIt(revocable.proxy, 1);
const overRevocable = behind(revocable.proxy, 2, plain);
revocable.revoke();
say("revoked", whileItLives, outcome(() => callIt(revocable.proxy, 1)), outcome(() => overRevocable(1)), outcome(() => revocable.proxy.bind(null)));

const proxied = new Proxy(adds(20), {});
const list = [1];
say("other ways to call", proxied.call(null, 1), proxied.apply(null, list), Reflect.apply(proxied, null, list), proxied(...list), ({ method: proxied }).method(1), [1].map(proxied)[0], proxied`text`);
say("as an accessor", Object.defineProperty({}, "value", { get: new Proxy(adds(21).bind(null, 1), {}) }).value, Object.defineProperty({}, "value", { get: adds(22).bind(null, 1) }).value);

const keeps = (tag) => function () { return [this, tag]; };
const receiver = { name: "receiver" };
const other = { name: "other" };
say("this", new Proxy(keeps("a"), {}).call(receiver)[0].name, keeps("b").bind(receiver).call(other)[0].name, new Proxy(keeps("c").bind(receiver), {}).call(other)[0].name, ({ name: "holder", method: new Proxy(keeps("d"), {}) }).method()[0].name);

const makes = (tag) => function Made(x) { this.tag = tag; this.x = x; this.target = new.target; };
const Made = makes("made");
const MadeProxy = new Proxy(Made, {});
const madeByProxy = new MadeProxy(1);
say("constructed through a proxy", madeByProxy.tag, madeByProxy.x, madeByProxy.target === MadeProxy, madeByProxy instanceof Made);
const MadeBound = Made.bind(null, 2);
const madeByBound = new MadeBound();
say("constructed through a bind", madeByBound.tag, madeByBound.x, madeByBound.target === Made, madeByBound instanceof Made);
const madeByBoth = new (new Proxy(MadeBound, {}))();
say("constructed through both", madeByBoth.tag, madeByBoth.x, madeByBoth.target === Made, madeByBoth instanceof Made);

const classes = (tag) => class Tagged { tag() { return tag; } };
const Tagged = classes("class");
say("a class", new (new Proxy(Tagged, {}))().tag(), outcome(() => new Proxy(Tagged, {})()), outcome(() => Tagged.bind(null)()), new (Tagged.bind(null))().tag());

function Shape(side) { this.side = side; }
Shape.prototype.grown = new Proxy(adds(28), {});
Shape.prototype.shrunk = adds(29).bind(null, -1);
Shape.prototype.area = new Proxy(((unit) => function () { return this.side * this.side + unit; })("cm"), {});
const shape = new Shape(3);
say("assigned to a prototype", shape.grown(1), shape.shrunk(), shape.area(), sum((x) => shape.grown(x) - 27));

class Meter {
  constructor(start) { this.value = start; }
}
Meter.prototype.read = new Proxy(((scale) => function () { return this.value * scale; })(10), {});
Meter.read = ((scale) => function () { return this === Meter ? scale : -scale; })(11).bind(Meter);
say("assigned to a class", new Meter(2).read(), Meter.read(), Meter.read.call(null));

say("too deep", outcome(() => behind(adds(23), 200000, bare)(1)), outcome(() => behind(adds(24).bind(null), 200000, bare)(1)), outcome(() => sum(behind(adds(25), 200000, plain))), outcome(() => new (behind(Made, 200000, bare))(1)));
say("afterward", behind(adds(26), 100, bare)(1), behind(adds(27).bind(null), 100, plain)(1));
