function rest(...all) {
  return all.join();
}
function named(a, b, c, d, e, f, g, h, i, j, k, l, m) {
  return [a, b, c, d, e, f, g, h, i, j, k, l, m].slice(0, arguments.length).join() + "/" + arguments.length;
}
function both(a, b, c, ...all) {
  return [a, b, c].join() + "|" + all.join() + "|" + this;
}
class Made {
  constructor(...all) {
    this.text = all.join() + (new.target === Made);
  }
}
class Heir extends Made {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    super(a, b, c, d, e, f, g, h, i, j);
    this.text += [a, j, arguments.length].join();
  }
}
function Old(a, b, c, d, e, f, g, h, i, j) {
  this.text = [a, b, c, d, e, f, g, h, i, j].join() + arguments.length + (new.target === Other);
}
function Other() {}
function Target(a, b, c, d, e, f, g, h, i, j) {
  this.text = [a, b, c, d, e, f, g, h, i, j].join() + arguments.length + (new.target === Target);
}
function fails(...all) {
  throw new RangeError(all.join());
}
const { hops, bounce } = class {
  static hops(next, ...all) {
    return next(...all);
  }
  static bounce(self, next, n, ...all) {
    return bounces(self, next, n - 1, ...all);
  }
};
const reflectApply = [Reflect.apply][0];
const reflectConstruct = [Reflect.construct][0];
const end = process.argv.length > 99 ? "x" : ";";
const spreads = new Function(
  "f",
  "self",
  "list",
  "const before = list.length, kept = 'k' + before; const result = f.call(self, ...list); return [result, before, kept].join(';')" +
    end,
);
const constructs = new Function("f", "list", "const kept = 'k' + list.length; return new f(...list).text + kept" + end);
const catches = new Function(
  "f",
  "list",
  "const kept = 'k' + list.length; try { return f(...list); } catch (error) { return error.message + kept; }" + end,
);
const joins = new Function("...all", "return all.join() + '/' + all.length" + end);
function ping(pong, n, a, b, c, d, e, f, g, h, i) {
  "use strict";
  return n ? pong(pong, ping, n - 1, a, b, c, d, e, f, g, h, i) : [a, b, c, d, e, f, g, h, i].join();
}
const pong = new Function(
  "pong",
  "ping",
  "n",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "'use strict'; return ping(pong, n, a, b, c, d, e, f, g, h, i)" + end,
);
const lines = [ping(pong, 300000, 1, 2, 3, 4, 5, 6, 7, 8, 9)];
for (let n = 0; n <= 24; n++) {
  const list = Array.from({ length: n }, (_, at) => "v" + at);
  const written = list.map((_, at) => "list[" + at + "]").join();
  const calls = new Function("f", "list", "const kept = 'k' + list.length; return f(" + written + ") + kept");
  const news = new Function("f", "list", "const kept = 'k' + list.length; return new f(" + written + ").text + kept");
  lines.push(
    spreads(rest, null, list),
    spreads(named, null, list),
    spreads(both, "t", list),
    calls(rest, list),
    calls(named, list),
  );
  lines.push(
    constructs(Made, list),
    constructs(Heir, list),
    constructs(Old, list),
    constructs(Target, list),
    news(Made, list),
    news(Heir, list),
    news(Target, list),
  );
  lines.push(catches(fails, list), spreads(hops, null, [joins, ...list]));
  if (n) lines.push(calls(hops, [joins, ...list].slice(0, n)));
  lines.push(reflectApply(rest, null, list), reflectApply(named, null, list), reflectApply(both, "t", list));
  lines.push(
    reflectConstruct(Made, list).text,
    reflectConstruct(Heir, list).text,
    reflectConstruct(Old, list, Other).text,
  );
  lines.push(rest.bind(null, "b")(...list), both.bind("s", "b", "c")(...list));
}
function digest(...all) {
  let sum = 0;
  for (let at = 0; at < all.length; at++) sum = (sum * 31 + all[at]) % 1000003;
  return [this, all.length, all[0], all[all.length - 1], sum].join();
}
function digestArguments(a, b, c, d, e, f, g, h, i, j) {
  let sum = 0;
  for (let at = 0; at < arguments.length; at++) sum = (sum * 31 + arguments[at]) % 1000003;
  return [a, b, c, d, e, f, g, h, i, j, arguments.length, sum].join();
}
function failsWithDigest(...all) {
  throw new RangeError(digest.apply("thrown", all));
}
class Digest {
  constructor(...all) {
    this.text = digest.apply(new.target === Digest, all);
  }
}
class DigestHeir extends Digest {
  constructor(a, ...all) {
    super(a, ...all);
    this.text += a;
  }
}
function OldDigest(a, b, c, d, e, f, g, h, i, j) {
  this.text = digestArguments.apply(null, arguments) + (new.target === OldDigest);
}
const digests = new Function(
  "...all",
  "let sum = 0; for (const value of all) sum = (sum * 31 + value) % 1000003; return all.length + ',' + sum" + end,
);
const bounces = new Function(
  "return class { static bounces(self, next, n, ...all) { return n ? self(self, next, n, ...all) : next(...all); } }.bounces" +
    end,
)();
for (const n of [
  4090, 4091, 4092, 4093, 4094, 4095, 4096, 4097, 4098, 4099, 4100, 4101, 4102, 4103, 4104, 4105, 4106, 5000, 5001,
  70001,
]) {
  const list = Array.from({ length: n }, (_, at) => (at * 7) % 1009);
  lines.push(
    spreads(digest, "s", list),
    spreads(digestArguments, null, list),
    catches(failsWithDigest, list),
    spreads(hops, null, [digests, ...list]),
  );
  lines.push(constructs(Digest, list), constructs(DigestHeir, list), constructs(OldDigest, list));
}
lines.push(
  bounce(bounce, digests, 3000, ...Array.from({ length: 4000 }, (_, at) => at % 89)),
  bounce(bounce, digests, 60, ...Array.from({ length: 6000 }, (_, at) => at % 89)),
);
const groups = "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)";
for (let n = 1; n <= 11; n++)
  lines.push(
    "abcdefghijk".replace(new RegExp(groups.slice(0, n * 3)), rest),
    "abcdefghijk".replace(new RegExp(groups.slice(0, n * 3), "g"), named),
  );
let waiting = 0;
for (const n of [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17]) {
  const list = Array.from({ length: n }, (_, at) => at);
  waiting += 2;
  setTimeout(
    (...all) => {
      lines.push("timer " + all.join());
      done();
    },
    0,
    ...list,
  );
  process.nextTick(
    function (a, b, c, d, e, f, g, h, i, j, k) {
      lines.push("tick " + [a, b, c, d, e, f, g, h, i, j, k].join() + arguments.length);
      done();
    },
    ...list,
  );
}
function done() {
  if (!--waiting) console.log(lines.join("\n"));
}
