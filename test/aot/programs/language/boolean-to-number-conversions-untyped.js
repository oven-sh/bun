const lines = [];
function show(value) {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value);
}

class Flags {
  on;
  maybe;
  orNull;
  orNumber;
  constructor(i) {
    this.on = (i & 1) === 1;
    if (i & 2)
      this.maybe = (i & 4) === 4;
    this.orNull = i % 3 === 0 ? null : i % 3 === 1;
    this.orNumber = i % 3 === 0 ? i + 0.5 : i % 3 === 1;
  }
}
const list = [true, false, false, true, true];
const mixed = [true, false, null, undefined, 2, "3", "", "x", 4n, {}, [], [5], { valueOf: () => 6 }];
const makers = [
  ["a comparison", (i) => (i & 3) === 0],
  ["an order", (i) => (i & 3) < 2],
  ["a negation", (i) => !(i & 1)],
  ["two negations", (i) => !!(i & 2)],
  ["true", () => true],
  ["false", () => false],
  ["Boolean()", (i) => Boolean(i & 1)],
  ["a typeof", (i) => typeof (i & 1 ? "text" : i) === "string"],
  ["an instanceof", (i) => (i & 1 ? new Flags(i) : {}) instanceof Flags],
  ["an in", (i) => ("maybe" in new Flags(i))],
  ["a field", (i) => new Flags(i).on],
  ["a field that may be missing", (i) => new Flags(i).maybe],
  ["a field that may be null", (i) => new Flags(i).orNull],
  ["a field that may be a number", (i) => new Flags(i).orNumber],
  ["an element", (i) => list[i % 5]],
  ["an element that may be missing", (i) => list[i % 7]],
  ["and", (i) => (i & 1) === 1 && (i & 2) === 2],
  ["or", (i) => (i & 1) === 1 || (i & 2) === 2],
  ["Array.isArray", (i) => Array.isArray(i & 1 ? [] : {})],
  ["Number.isInteger", (i) => Number.isInteger(i & 1 ? i : i + 0.5)],
  ["a text's answer", (i) => "abc".includes(i & 1 ? "b" : "x")],
  ["anything", (i) => mixed[i % mixed.length]]
];
const conversions = [
  ["Number()", (b) => Number(b)],
  ["plus", (b) => +b],
  ["minus", (b) => -b],
  ["minus plus", (b) => -+b],
  ["times one", (b) => b * 1],
  ["less nothing", (b) => b - 0],
  ["or nothing", (b) => b | 0],
  ["two tildes", (b) => ~~b],
  ["a tilde", (b) => ~b],
  ["shifted", (b) => b << 3],
  ["shifted without sign", (b) => -b >>> 28],
  ["and itself", (b) => b + b],
  ["and one", (b) => b + 1],
  ["and a half", (b) => b + 0.5],
  ["and a text", (b) => b + "!"],
  ["Number() and plus", (b) => Number(b) + +b],
  ["one through it", (b) => 1 / +b],
  ["one through its negative", (b) => 1 / -b],
  ["squared", (b) => b ** 2],
  ["the rest", (b) => 7 % +b],
  ["counted up", (b) => {
    let c = b;
    c++;
    return c;
  }],
  ["counted up, the old value", (b) => {
    let c = b;
    return c++;
  }],
  ["counted down", (b) => {
    let c = b;
    --c;
    return c;
  }],
  ["added to", (b) => {
    let c = b;
    c += 2;
    return c;
  }],
  ["as an index", (b) => ["no", "yes", "more"][+b]],
  ["as an index by Number()", (b) => ["no", "yes", "more"][Number(b)]],
  ["in a template", (b) => `${+b}|${Number(b)}`],
  ["compared with one", (b) => +b === 1],
  ["loosely the same as one", (b) => b == 1],
  ["below one", (b) => b < 1],
  ["isNaN", (b) => isNaN(+b)],
  ["Math.max", (b) => Math.max(b, 0.5)],
  ["Math.abs of the negative", (b) => Math.abs(-b)],
  ["Math.sign", (b) => Math.sign(-b)],
  ["Math.round", (b) => Math.round(-b)],
  ["toFixed", (b) => Number(b).toFixed(1)],
  ["typeof", (b) => typeof +b + typeof Number(b)],
  ["in a switch", (b) => {
    switch (+b) {
      case 0:
        return "zero";
      case 1:
        return "one";
      default:
        return "other";
    }
  }],
  ["summed in a loop", (b) => {
    let sum = 0;
    for (let k = 0;k < 5; k++)
      sum += +b;
    return sum;
  }],
  ["into a typed array", (b) => {
    const words = new Int8Array(1);
    words[0] = b;
    return words[0];
  }],
  ["new Number()", (b) => new Number(b).valueOf()]
];
for (const [make, maker] of makers) {
  for (const [name, convert] of conversions) {
    const once = [];
    for (let i = 0;i < 14; i++) {
      try {
        once.push(show(convert(maker(i))));
      } catch (error) {
        once.push(error.constructor.name);
      }
    }
    let often = 0;
    let failures = 0;
    for (let i = 0;i < 3000; i++) {
      try {
        const answer = convert(maker(i));
        often = often + (typeof answer === "number" ? answer === answer && answer !== 1 / 0 && answer !== -1 / 0 ? answer * 2 : 3 : show(answer).length) | 0;
      } catch {
        failures++;
      }
    }
    lines.push(make + ", " + name + ": " + once.join(" ") + " | " + often + " " + failures);
  }
}
function ofABoolean(b) {
  let counted = b;
  counted++;
  let old = b;
  const before = old++;
  let down = b;
  --down;
  let sum = 0;
  for (let k = 0;k < 5; k++)
    sum += +b;
  const words = new Int8Array(1);
  words[0] = b;
  const any = b;
  return [
    Number(b),
    +b,
    -b,
    -+b,
    any * 1,
    any - 0,
    any | 0,
    ~~any,
    ~any,
    any << 3,
    -any >>> 28,
    any + any,
    any + 1,
    any + 0.5,
    Number(b) + +b,
    1 / +b,
    1 / -b,
    any ** 2,
    7 % +b,
    counted,
    before,
    old,
    down,
    sum,
    words[0],
    ["no", "yes"][+b],
    ["no", "yes"][Number(b)],
    `${+b}|${Number(b)}`,
    +b === 1,
    any == 1,
    any < 1,
    isNaN(+b),
    Math.max(any, 0.5),
    Math.abs(-b),
    Math.sign(-b),
    Math.round(-b),
    Number(b).toFixed(1),
    typeof +b,
    +b ? "truthy" : "falsy",
    (+b).toString(2),
    +b + 2147483647,
    (+b - 1) * 5,
    Number(!b) - Number(b)
  ].map(show).join(" ");
}
function ofTrue() {
  const b = true;
  let counted = b;
  counted++;
  let old = b;
  const before = old++;
  let down = b;
  --down;
  let sum = 0;
  for (let k = 0;k < 5; k++)
    sum += +b;
  const words = new Int8Array(1);
  words[0] = b;
  const any = b;
  return [
    Number(b),
    +b,
    -b,
    -+b,
    any * 1,
    any - 0,
    any | 0,
    ~~any,
    ~any,
    any << 3,
    -any >>> 28,
    any + any,
    any + 1,
    any + 0.5,
    Number(b) + +b,
    1 / +b,
    1 / -b,
    any ** 2,
    7 % +b,
    counted,
    before,
    old,
    down,
    sum,
    words[0],
    ["no", "yes"][+b],
    ["no", "yes"][Number(b)],
    `${+b}|${Number(b)}`,
    +b === 1,
    any == 1,
    any < 1,
    isNaN(+b),
    Math.max(any, 0.5),
    Math.abs(-b),
    Math.sign(-b),
    Math.round(-b),
    Number(b).toFixed(1),
    typeof +b,
    +b ? "truthy" : "falsy",
    (+b).toString(2),
    +b + 2147483647,
    (+b - 1) * 5,
    Number(!b) - Number(b)
  ].map(show).join(" ");
}
function ofFalse() {
  const b = false;
  let counted = b;
  counted++;
  let old = b;
  const before = old++;
  let down = b;
  --down;
  let sum = 0;
  for (let k = 0;k < 5; k++)
    sum += +b;
  const words = new Int8Array(1);
  words[0] = b;
  const any = b;
  return [
    Number(b),
    +b,
    -b,
    -+b,
    any * 1,
    any - 0,
    any | 0,
    ~~any,
    ~any,
    any << 3,
    -any >>> 28,
    any + any,
    any + 1,
    any + 0.5,
    Number(b) + +b,
    1 / +b,
    1 / -b,
    any ** 2,
    7 % +b,
    counted,
    before,
    old,
    down,
    sum,
    words[0],
    ["no", "yes"][+b],
    ["no", "yes"][Number(b)],
    `${+b}|${Number(b)}`,
    +b === 1,
    any == 1,
    any < 1,
    isNaN(+b),
    Math.max(any, 0.5),
    Math.abs(-b),
    Math.sign(-b),
    Math.round(-b),
    Number(b).toFixed(1),
    typeof +b,
    +b ? "truthy" : "falsy",
    (+b).toString(2),
    +b + 2147483647,
    (+b - 1) * 5,
    Number(!b) - Number(b)
  ].map(show).join(" ");
}
function ofAComparison(i) {
  const b = (i & 3) === 0;
  let counted = b;
  counted++;
  let old = b;
  const before = old++;
  let down = b;
  --down;
  let sum = 0;
  for (let k = 0;k < 5; k++)
    sum += +b;
  const words = new Int8Array(1);
  words[0] = b;
  const any = b;
  return [
    Number(b),
    +b,
    -b,
    -+b,
    any * 1,
    any - 0,
    any | 0,
    ~~any,
    ~any,
    any << 3,
    -any >>> 28,
    any + any,
    any + 1,
    any + 0.5,
    Number(b) + +b,
    1 / +b,
    1 / -b,
    any ** 2,
    7 % +b,
    counted,
    before,
    old,
    down,
    sum,
    words[0],
    ["no", "yes"][+b],
    ["no", "yes"][Number(b)],
    `${+b}|${Number(b)}`,
    +b === 1,
    any == 1,
    any < 1,
    isNaN(+b),
    Math.max(any, 0.5),
    Math.abs(-b),
    Math.sign(-b),
    Math.round(-b),
    Number(b).toFixed(1),
    typeof +b,
    +b ? "truthy" : "falsy",
    (+b).toString(2),
    +b + 2147483647,
    (+b - 1) * 5,
    Number(!b) - Number(b)
  ].map(show).join(" ");
}
function ofAField(flags) {
  const b = flags.on;
  let counted = b;
  counted++;
  let old = b;
  const before = old++;
  let down = b;
  --down;
  let sum = 0;
  for (let k = 0;k < 5; k++)
    sum += +b;
  const words = new Int8Array(1);
  words[0] = b;
  const any = b;
  return [
    Number(b),
    +b,
    -b,
    -+b,
    any * 1,
    any - 0,
    any | 0,
    ~~any,
    ~any,
    any << 3,
    -any >>> 28,
    any + any,
    any + 1,
    any + 0.5,
    Number(b) + +b,
    1 / +b,
    1 / -b,
    any ** 2,
    7 % +b,
    counted,
    before,
    old,
    down,
    sum,
    words[0],
    ["no", "yes"][+b],
    ["no", "yes"][Number(b)],
    `${+b}|${Number(b)}`,
    +b === 1,
    any == 1,
    any < 1,
    isNaN(+b),
    Math.max(any, 0.5),
    Math.abs(-b),
    Math.sign(-b),
    Math.round(-b),
    Number(b).toFixed(1),
    typeof +b,
    +b ? "truthy" : "falsy",
    (+b).toString(2),
    +b + 2147483647,
    (+b - 1) * 5,
    Number(!b) - Number(b)
  ].map(show).join(" ");
}
const seen = new Map;
function count(label, text) {
  const key = label + ": " + text;
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
for (let i = 0;i < 3000; i++) {
  count("a boolean", ofABoolean((i & 1) === 1));
  count("a boolean", ofABoolean(!(i % 3)));
  count("true", ofTrue());
  count("false", ofFalse());
  count("a comparison", ofAComparison(i));
  count("a field", ofAField(new Flags(i)));
}
for (const [key, times] of seen)
  lines.push(key + " x " + times);
console.log(lines.join(`
`));
