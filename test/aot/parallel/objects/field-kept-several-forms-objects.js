// A field kept in several forms is asked for in objects that nobody followed.
// Flags: --aot-validate --aot-limit=MaxGuardAvailabilityWork:0
class Count {
  constructor(s, isFilled) {
    this.a = 1;
    if (isFilled) this.x = s;
  }
  own() {
    let sum = 0;
    for (let i = 0; i < 200; i++) sum = (sum + (this.x ?? 1) + i) | 0;
    return sum;
  }
}
class Text {
  constructor(s, isFilled) {
    this.a = 1;
    this.b = 2;
    if (isFilled) this.x = "t" + s;
  }
  own() {
    let sum = 0;
    for (let i = 0; i < 200; i++) sum = (sum + (this.x ?? "").length + i) | 0;
    return sum;
  }
}
class Flag {
  constructor(s, isFilled) {
    this.a = 1;
    this.b = 2;
    this.c = 3;
    if (isFilled) this.x = s % 2 === 0;
  }
  own() {
    let sum = 0;
    for (let i = 0; i < 200; i++) sum = (sum + (this.x ? 1 : 2) + i) | 0;
    return sum;
  }
}
class Fraction {
  constructor(s, isFilled) {
    this.a = 1.5;
    if (isFilled) this.x = s / 4 + 0.1;
  }
  own() {
    let sum = 0;
    for (let i = 0; i < 200; i++) sum += (this.x ?? 0.5) + i;
    return sum;
  }
}
function make(kind, s) {
  const isFilled = kind % 3 !== 0;
  switch (kind % 4) {
    case 0:
      return new Count(s, isFilled);
    case 1:
      return new Text(s, isFilled);
    case 2:
      return new Flag(s, isFilled);
    default:
      return new Fraction(s, isFilled);
  }
}
const held = [];
for (let at = 0; at < 24; at++) held.push(make(at, at * 3));

function arrived(o) {
  return JSON.parse("[0]", (key, value) => (key === "0" ? o : value))[0];
}
function chosen(first, second, d) {
  const a = arrived(first);
  const b = arrived(second);
  const one = d % 2 ? a : b;
  let sum = "" + one.a;
  const got = one.x !== undefined ? one : a;
  sum += typeof got.x + typeof one.x;
  return sum;
}

let total = 0;
for (let turn = 0; turn < 40; turn++) for (const each of held) total = (total + each.own()) | 0;
console.log(total);
console.log(chosen(held[0], held[1], 0), chosen(held[1], held[2], 1), chosen(held[2], held[3], 2));
console.log(chosen(held[3], held[4], 3), chosen(held[5], held[6], 4), chosen(held[7], held[9], 5));
