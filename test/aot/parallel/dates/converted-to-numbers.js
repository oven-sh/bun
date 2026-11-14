// A Date becomes a number by +, -, * and <. What is stored on it, on its class or by its neighbor's valueOf decides first.
const now = new Date(Date.UTC(2026, 0, 15, 10, 30));
const later = new Date(+now + 86400000);
const unknown = JSON.parse('[0, 1]').map((_, k) => (k ? later : now));
const [first, second] = unknown;
let total = 0;
for (let k = 0; k < 300; k++) {
  const date = unknown[k & 1];
  total += +date - first + (date < second ? 1 : 0) + (date >= first ? 2 : 0) + Number(date) % 7 + -date % 5 + (date * 2) % 11 + (date / 3) % 2 + (date | 0) + (~date & 3) + Math.max(date, 5) % 13 + isNaN(date);
}
console.log(total, second - first, first - 1 === first.getTime() - 1, first > second, first <= first, first >= second, 5 - first < 0);
console.log(first + 1 === first.toString() + "1", `${first}` === String(first), first == String(first), first == first.getTime(), typeof (first + second));

// An invalid date, the ends, minus zero.
for (const time of [NaN, 8.64e15, -8.64e15, -0, 0, 1.9, -1]) {
  const date = new Date(time);
  console.log(+date, Object.is(+date, -0), date - 0, date < 0, date <= 0, date > 0, -date, date * -1, date ** 2, date % 10);
}

// Own methods, subclasses, other prototypes.
const own = new Date(5);
own.valueOf = () => 7;
const symbolic = new Date(5);
symbolic[Symbol.toPrimitive] = hint => (hint === "number" ? 11 : hint);
class Later extends Date {
  valueOf() {
    return super.valueOf() + 100;
  }
}
class Hinted extends Date {
  [Symbol.toPrimitive](hint) {
    return hint + super.getTime();
  }
}
class Same extends Date {}
const bare = Object.setPrototypeOf(new Date(5), null);
const moved = Object.setPrototypeOf(new Date(5), { valueOf: () => 13, toString: () => "moved" });
const below = Object.setPrototypeOf(new Date(5), Object.create(Date.prototype, { valueOf: { value: () => 17 } }));
for (const date of [own, symbolic, new Later(5), new Hinted(5), new Same(5), moved, below, new Proxy(new Date(5), {})]) {
  for (const convert of [date => +date, date => date - 1, date => 20 - date, date => date * 2, date => date < 10, date => 10 < date, date => Number(date), date => -date, date => date + 1, date => ~date, date => Math.abs(date)]) {
    try {
      console.log(convert(date));
    } catch (error) {
      console.log(error.name);
    }
  }
}
for (const convert of [date => +date, date => date - 1, date => date < 1, date => `${date}`]) {
  try {
    console.log(convert(bare));
  } catch (error) {
    console.log(error.name);
  }
}

// The left operand is converted first, and it may change the right one.
const changed = new Date(5);
const changes = {
  valueOf() {
    changed.setTime(changed.getTime() * 10);
    return 1;
  },
};
console.log(changes - changed, changed - changes, changes < changed, changed < changes, changes * changed, changed.getTime());
const refuses = {
  valueOf() {
    throw new RangeError("left");
  },
};
for (const compute of [() => refuses - changed, () => changed - refuses, () => Symbol() - changed, () => changed - Symbol(), () => changed * 1n, () => 1n < changed]) {
  try {
    console.log(compute());
  } catch (error) {
    console.log(error.name, error.message === "left");
  }
}

// Dates of another realm.
const other = require("node:vm").runInNewContext("new Date(1234)");
console.log(+other, other - 1, other < now, now > other, Number(other), other instanceof Date);
