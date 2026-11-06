// A loop holds numbers and objects while it reads object[key], object[head + tail] and list[index]. Whatever such a read does on its way, a field, a getter that computes,
// a proxy, a key that has to be converted, an error that is caught, a collection, the loop goes on with what it held.
const never = process.argv.length > 1000;
const unknown = new Function("value", "return value;" + (never ? " " : ""));
const text = (...codes) => unknown(String.fromCharCode(...codes));
const lines = [];
const show = value =>
  typeof value === "function"
    ? "function " + value.name
    : Object.is(value, -0)
      ? "-0"
      : typeof value === "object" && value
        ? JSON.stringify(value)
        : String(value);
const note = (label, ...values) => lines.push(label + ": " + values.map(show).join(" "));

const head = text(107);
const tails = [text(97), text(98), text(99), text(100), text(101), text(102), text(103), text(104)];
const keys = tails.map(tail => unknown(head + tail));

// Eight numbers, more than a read keeps in registers, and three objects.
function byParts(object, turns) {
  let a = 0.5, b = 1.25, c = -2.5, d = 1e-3, e = 3.75, f = 0.125, g = 7.5, h = -0.0625;
  const first = { n: 1 }, second = [2], third = "three";
  for (let i = 0; i < turns; i++) {
    const found = object[head + tails[i & 7]];
    const number = typeof found === "number" ? found : found === undefined ? 0.5 : 2;
    a += number;
    b = b * 1.0000001 + a * 1e-9;
    c -= number * 0.5;
    d += b - c;
    e = e * 0.999 + number;
    f += e * 1e-3;
    g -= f * 1e-3;
    h += g * 1e-6 + first.n + second[0] + third.length;
  }
  return [a, b, c, d, e, f, g, h].map(each => each.toFixed(6)).join(" ");
}
function byKey(object, turns) {
  let a = 0.5, b = 1.25, c = -2.5, d = 1e-3, e = 3.75, f = 0.125, g = 7.5, h = -0.0625;
  for (let i = 0; i < turns; i++) {
    const found = object[keys[i & 7]];
    const number = typeof found === "number" ? found : found === undefined ? 0.5 : 2;
    a += number;
    b = b * 1.0000001 + a * 1e-9;
    c -= number * 0.5;
    d += b - c;
    e = e * 0.999 + number;
    f += e * 1e-3;
    g -= f * 1e-3;
    h += g * 1e-6;
  }
  return [a, b, c, d, e, f, g, h].map(each => each.toFixed(6)).join(" ");
}
function byAnything(object, what, turns) {
  let a = 0.5, b = 1.25, c = -2.5, d = 1e-3;
  for (let i = 0; i < turns; i++) {
    const found = object[what[i % what.length]];
    const number = typeof found === "number" ? found : found === undefined ? 0.5 : 2;
    a += number;
    b = b * 1.0000001 + a * 1e-9;
    c -= number * 0.5;
    d += b - c;
  }
  return [a, b, c, d].map(each => each.toFixed(6)).join(" ");
}
function catching(object, turns) {
  let a = 0.5, b = 1.25, c = -2.5, caught = 0;
  for (let i = 0; i < turns; i++) {
    try {
      a += object[head + tails[i & 7]];
      b += object[keys[(i + 3) & 7]];
    } catch (error) {
      caught += error.message.length;
      c += a * 1e-3 - b * 1e-3;
    }
  }
  return [a, b, c, caught].map(each => each.toFixed(6)).join(" ");
}

const busy = x => {
  let p = x + 0.1, q = x * 1.7, r = x - 3.3, s = x / 7, t = x + 11.5, u = x * x, v = 1 / (x + 2), w = Math.sqrt(x + 9);
  for (let i = 0; i < 3; i++) {
    p += q * r;
    q -= s * t;
    r += u * v;
    s -= w * p * 1e-6;
  }
  return (p + q + r + s + t + u + v + w) % 5;
};
let litter = [];
const objects = {
  "fields that are integers": { ka: 1, kb: 2, kc: 3, kd: 4, ke: 5, kf: 6, kg: 7, kh: 8 },
  "fields of every kind": { ka: 1, kb: 2.5, kc: "text", kd: true, ke: null, kf: undefined, kg: { inner: 1 }, kh: -0 },
  "some are missing": { ka: 1, kc: 3.5, kg: 9 },
  "getters that compute": {
    get ka() { return busy(1); },
    kb: 2,
    get kc() { return busy(this.kb); },
    kd: 4.5,
    get ke() { litter.push({ at: litter.length }, [1.5, 2.5]); if (litter.length > 2000) litter = []; return busy(3); },
    kf: 6,
    get kg() { return busy(4) + byKey({ ka: 1, kb: 2 }, 9).length; },
    kh: 8,
  },
  "inherited": Object.create({ ka: 1, kb: 2.5, get kc() { return busy(5); } }, { kd: { value: 4 }, ke: { get: () => busy(6) } }),
  "parsed": JSON.parse('{"ka":1,"kb":2.5,"kc":"text","kd":4,"ke":null,"kf":6,"kg":[7],"kh":8}'),
  "a proxy": new Proxy({ ka: 1, kb: 2 }, { get: (target, key) => (key in target ? target[key] + busy(7) : busy(key.length)) }),
  "a list": [1, 2.5, 3],
  "a text": "some text",
  "bytes": new Uint8Array([1, 2, 3, 4]),
  "a function": Object.assign(function named() {}, { ka: 1.5, kh: 2 }),
  "a map": new Map([["ka", 1]]),
};
const filled = {};
for (let i = 0; i < 300; i++) filled[head + i] = i * 0.5;
for (const [at, tail] of tails.entries()) filled[head + tail] = at + (at & 1 ? 0.5 : 0);
objects["filled by key"] = filled;
for (const [label, object] of Object.entries(objects)) {
  note(label + ", by parts", byParts(object, 400));
  note(label + ", by key", byKey(object, 400));
}

// The key is anything: an index, a number that is no index, a text that is an index, a symbol, an object that is converted by code that computes.
const symbol = Symbol("mine");
const converted = { toString: () => "k" + "abcdefgh"[Math.floor(busy(2)) & 7] };
const anything = [0, 1, 2, 7, -1, 1.5, "0", "1", "ka", "length", symbol, converted, null, undefined, true, 2 ** 31, 2 ** 32 - 1, NaN];
for (const [label, object] of Object.entries(objects)) note(label + ", by anything", byAnything(object, anything, 360));
note("nothing to read from", (() => { try { return byAnything(unknown(null), anything, 3); } catch (error) { return error.constructor.name; } })());

const throwing = {
  ka: 1,
  get kb() { throw new Error("from kb"); },
  kc: 3.5,
  kd: 4,
  get ke() { busy(8); throw new RangeError("from the getter of ke"); },
  kf: 6,
  kg: 7.25,
  kh: 8,
};
note("errors that are caught", catching(throwing, 400));
note("errors out of a proxy", catching(new Proxy(throwing, { get(target, key) { if (key === "kg") throw new TypeError("trapped"); return target[key]; } }), 400));

// Integers at both ends of their range, in fields that always hold one and in fields that may hold nothing.
{
  const always = { ka: -2147483648, kb: -2147483647, kc: -2147483646, kd: -2147483645, ke: -2147483644, kf: -2147483643, kg: 2147483647, kh: 0 };
  class Sometimes {
    ka; kb; kc; kd; ke; kf; kg; kh;
    constructor(from) { for (const key of keys) if (from[key] !== "skip") this[key] = from[key]; }
  }
  const sometimes = [
    new Sometimes(always),
    new Sometimes({ ka: 1, kb: undefined, kc: null, kd: "skip", ke: -2147483648, kf: -2147483644, kg: 7, kh: -1 }),
  ];
  delete sometimes[1].kh;
  const seen = [];
  for (let round = 0; round < 4; round++)
    for (const object of [always, ...sometimes]) for (const tail of tails) seen.push(object[head + tail]);
  note("integers at the ends", ...seen.slice(-24));
  note("all rounds alike", seen.every((each, at) => Object.is(each, seen[at % 24])));
  always.kb = 1.5;
  always.kc = "a text";
  sometimes[0].ka = undefined;
  sometimes[0].kg = 2 ** 31;
  note("stored to", ...tails.map(tail => always[head + tail]), ...tails.map(tail => sometimes[0][head + tail]));
}

// References: to objects, functions and texts, and nothing in their place.
{
  function one() {}
  const references = { ka: one, kb: { b: 1 }, kc: "written", kd: text(109, 97, 100, 101), ke: [1], kf: null, kg: undefined, kh: () => 1 };
  const seen = [];
  for (let round = 0; round < 4; round++) for (const tail of tails) seen.push(references[head + tail]);
  note("references", ...seen.slice(-8), seen.every((each, at) => each === seen[at & 7]));
  references.kf = one;
  references.ka = null;
  references.kb = 5;
  note("references stored to", ...tails.map(tail => references[head + tail]));
}

// Values in the object and behind it, far behind it too.
{
  const plain = unknown({});
  for (let i = 0; i < 1200; i++) plain[head + i] = i;
  let sum = 0;
  for (let round = 0; round < 3; round++) for (let i = 0; i < 1210; i++) sum += plain[head + i] ?? 0.25;
  note("twelve hundred names", sum);
  const few = JSON.parse('{"k0":10,"k1":"one","k2":null,"k3":[3],"k4":4.5}');
  const seen = [];
  for (let round = 0; round < 3; round++) for (let i = 0; i < 6; i++) seen.push(few[head + i]);
  note("five names", ...seen.slice(-6));
}

console.log(lines.join("\n"));
