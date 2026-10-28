// Date.prototype.toISOString is reached directly, on an instance of a class below Date, under a key found at run time, through call and apply, as a value, from toJSON and from JSON.stringify.
// Each text is held against one put together from the UTC parts of the date.
const day = 86400000;
const times = [
  0,
  1,
  -1,
  999,
  1000,
  -999,
  -1000,
  1700000000123,
  951782400000,
  951868800000,
  4107542399999,
  day * 365,
  -day * 365,
  -62167219200000,
  -62167219200001,
  -62198755200000,
  253402300799999,
  253402300800000,
  8.64e15,
  -8.64e15,
  8.64e15 - 1,
  -8.64e15 + 1,
  -2208988800000,
  68169600000,
  1709164800000,
  1709251199999,
  -1e15,
  1e15,
  1.5,
  -1.5,
];

function pad(value, digits) {
  return String(value).padStart(digits, "0");
}
function fromParts(date) {
  const year = date.getUTCFullYear();
  const yearText = year < 0 ? "-" + pad(-year, 6) : year > 9999 ? "+" + pad(year, 6) : pad(year, 4);
  return (
    `${yearText}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}Z`
  );
}

class Stamp extends Date {}
const keys = ["toISOString", "toJSON"];
const asValue = Date.prototype.toISOString;
const bound = time => asValue.bind(new Date(time));

const ways = {
  direct: time => new Date(time).toISOString(),
  heir: time => new Stamp(time).toISOString(),
  withOwnProperty: time => Object.assign(new Date(time), { extra: 1 }).toISOString(),
  underKey: time => new Date(time)[keys[0]](),
  toJSONUnderKey: time => new Date(time)[keys[1]](),
  call: time => Date.prototype.toISOString.call(new Date(time)),
  apply: time => Reflect.apply(asValue, new Stamp(time), []),
  bound: time => bound(time)(),
  toJSON: time => new Date(time).toJSON(),
  stringify: time => JSON.parse(JSON.stringify(new Date(time))),
  stringifyInside: time => JSON.parse(JSON.stringify({ at: new Stamp(time) })).at,
  afterSetTime: time => {
    const date = new Date(0);
    date.setTime(time);
    return date.toISOString();
  },
};

let differences = 0;
for (const time of times) {
  const expected = fromParts(new Date(time));
  const odd = Object.keys(ways).filter(way => ways[way](time) !== expected);
  differences += odd.length;
  console.log(time, expected, odd.length ? "differs: " + odd.join(" ") : "");
}
console.log("differences", differences);

for (const time of [NaN, Infinity, 8.64e15 + 1, -8.64e15 - 1]) {
  for (const way of Object.keys(ways)) {
    let answer;
    try {
      answer = String(ways[way](time));
    } catch (error) {
      answer = error.name + ": " + error.message;
    }
    console.log(time, way, answer);
  }
}
for (const receiver of [undefined, null, 0, "2026", {}, Object.create(Date.prototype), Date.prototype]) {
  try {
    console.log(asValue.call(receiver));
  } catch (error) {
    console.log(error.name);
  }
}
