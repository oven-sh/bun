// Prints the bytes of enum members, static fields, defaults and compound assignments that are not numbers. Where an assignment raises to one half, it prints them without the sign.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const text = (value: number) => {
  number[0] = value;
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("");
};
const withoutSign = (value: number) => (parseInt(text(value).slice(0, 1), 16) & 7).toString(16) + text(value).slice(1);
enum Plain {
  Quotient = 0 / 0,
  Difference = Infinity - Infinity,
  Negated = -(0 / 0),
  Root = (-1) ** 0.5,
  Rest = 1 % 0,
  Product = Infinity * 0,
  Written = NaN,
  Minus = -NaN,
  Next = Quotient + 1,
  Twice = Negated * 2,
}
console.log(
  "enum",
  text(Plain.Quotient),
  text(Plain.Difference),
  text(Plain.Negated),
  text(Plain.Root),
  text(Plain.Rest),
  text(Plain.Product),
  text(Plain.Written),
  text(Plain.Minus),
  text(Plain.Next),
  text(Plain.Twice),
);
console.log(
  "by key",
  Object.keys(Plain)
    .filter(key => typeof (Plain as any)[key] === "number")
    .map(key => text((Plain as any)[key]))
    .join(" "),
);
class Holder {
  static quotient = 0 / 0;
  static negated = -(0 / 0);
  static root = Math.sqrt(-1);
  quotient = 0 / 0;
  negated = -NaN;
  root = (-4) ** 0.5;
}
const holder = new Holder();
console.log(
  "fields",
  text(Holder.quotient),
  text(Holder.negated),
  text(Holder.root),
  text(holder.quotient),
  text(holder.negated),
  text(holder.root),
);
function defaults(quotient = 0 / 0, negated = -(0 / 0), root = Math.sqrt(-1), power = (-1) ** 1.5) {
  return [text(quotient), text(negated), text(root), text(power)].join(" ");
}
console.log("defaults", defaults());
let a = 0,
  b = Infinity,
  c = 0,
  d = -1,
  e = 1,
  f = -1;
a /= 0;
b -= Infinity;
c *= Infinity;
d **= 0.5;
e %= 0;
f **= 1.5;
console.log("assignments", text(a), text(b), text(c), withoutSign(d), text(e), text(f));
console.log(
  "conversions",
  text(+undefined!),
  text(+"x"),
  text(-"x"),
  text(Number("x")),
  text(-Number("x")),
  text(parseFloat("x")),
  text(parseInt("x")),
  text(Number(undefined)),
  text(("a" as any) - ("b" as any)),
  text(("a" as any) * 1),
  text(-(undefined as any)),
  text(+{}),
  text(Number.NaN),
  text(-Number.NaN),
  text(globalThis.NaN),
  text(-globalThis.NaN),
);
console.log(
  "lists",
  [0 / 0, -(0 / 0), Math.sqrt(-1), NaN, -NaN].map(text).join(" "),
  Float64Array.of(0 / 0, -(0 / 0), Math.sqrt(-1), NaN, -NaN).reduce((all, value) => all + " " + text(value), ""),
);
const frozen = Object.freeze({ quotient: 0 / 0, negated: -(0 / 0), root: Math.sqrt(-1), minus: -NaN });
console.log("literal", text(frozen.quotient), text(frozen.negated), text(frozen.root), text(frozen.minus));
const view = new DataView(new ArrayBuffer(8));
const through = (value: number) => {
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16);
};
console.log(
  "data view",
  through(0 / 0),
  through(-(0 / 0)),
  through(Math.sqrt(-1)),
  through(-NaN),
  through(Plain.Negated),
  through((-1) ** 0.5),
);
const buffer = Buffer.alloc(8);
const written = (value: number) => {
  buffer.writeDoubleBE(value);
  return buffer.toString("hex");
};
console.log(
  "buffer",
  written(0 / 0),
  written(-(0 / 0)),
  written(Math.sqrt(-1)),
  written(-NaN),
  written(Plain.Negated),
  written((-1) ** 0.5),
);
for (const whole of [-7, -1, 0, 1, 7]) {
  const none = whole - whole;
  console.log(
    "whole remainders",
    whole,
    text(whole % none),
    text((whole | 0) % (none | 0)),
    text(whole % 0),
    text((whole + 0.5) % none),
  );
}
