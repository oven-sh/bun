// Functions that calculate with constant arguments alone, beside ones that do more: defaults, missing and extra arguments, zeros of both signs, texts, switches, short loops, types, dead zones, replaced functions, methods, throws.
const show = (v: any) => (Object.is(v, -0) ? "-0" : typeof v + ":" + String(v));
const limit = 50;
let calls = 0;
function grade(points: any): any {
  let text = "";
  switch (true) {
    case points >= 90:
      text = "A";
      break;
    case points >= limit: {
      const rest = points - limit;
      text = "B" + rest;
      break;
    }
    default:
      text = "C";
  }
  switch (points % 3) {
    case 0:
    case 1:
      return text + "low";
    case 2:
      return text + "two";
  }
  return text;
}
function sign(x: any, y = -0): any {
  const t = x * y;
  if (t === 0) return 1 / t > 0 ? "plus" : "minus";
  return x === undefined ? "nothing" : x != x ? "NaN" : t;
}
function count(n: any, s: any): any {
  let t = s;
  for (let i = 0; i < n; i++) {
    if (i === 3) break;
    t = t + i;
  }
  return typeof t === "string" ? `${t}/${t.length}` : t;
}
function word(w: any): any {
  switch (w) {
    case "a":
    case "é":
      return w + "!";
    case "日本":
      return w > "a" ? "wide" + w : w;
    case 1:
      return "one";
    case null:
      return "null";
  }
  return w === true ? "yes" : w ? "some" : "none";
}
function counted(x: any): any {
  calls++;
  if (x > 2) return x > 3 ? x * 5 + 1 : x * 7 + 2;
  return x > 1 ? x * 11 + 3 : x > 0 ? x * 13 + 4 : x * 17 + 5;
}
function early(x: any): any {
  if (x > 5) return x > 7 ? x + late : x * 2 + 1;
  return x > 3 ? x * 3 + 1 : x > 1 ? x * 5 + 2 : x * 7 + 3;
}
function refuse(x: any): any {
  if (x > 5) throw new RangeError("refused " + x);
  return x > 3 ? x * 3 + 1 : x > 1 ? x * 5 + 2 : x * 7 + 3;
}
function own(this: any, x: any): any {
  if (x > 5) return this === undefined || this === globalThis ? "bare" : this.name + x;
  return x > 3 ? x * 3 + 1 : x > 1 ? x * 5 + 2 : arguments.length + x * 7 + 3;
}
let swapped = (x: any): any => (x > 3 ? x * 3 + 1 : x > 1 ? x * 5 + 2 : x * 7 + 3);
class Table {
  static row(x: any): any {
    return x > 3 ? x * 3 + 1 : x > 1 ? x * 5 + 2 : x * 7 + 3 + (x < -1 ? 0.5 : 0);
  }
}
const holder = { name: "h", own };
function run(k: number): any[] {
  const out: any[] = [];
  for (let i = 0; i < k; i++) {
    out.length = 0;
    out.push(grade(95), grade(90), grade(52), grade(50), grade(0), grade(2), grade("60"), grade(0.5), grade(-0), grade(NaN), grade(undefined), grade(i));
    out.push(sign(0), sign(-0), sign(5), sign(5, 2), sign(undefined, 3), sign(NaN, 2), sign(0, 5), sign(-3, 0), sign(1e308, 1e10), sign(0.1, 3));
    out.push(count(0, 5), count(2, 0.5), count(9, "x"), count("2", "n"), count(undefined, true), count(3, -0), count(1e9, 1));
    out.push(word("a"), word("é"), word("日本"), word(1), word(null), word(true), word(""), word(0), word(-0), word("b"), word(undefined));
    out.push(counted(3), counted(0.5), counted(-1), early(4), early(6), refuse(2), refuse(-1), own(4), own(7), holder.own(8), own(0.5), (own as any)(1, 2, 3));
    out.push(swapped(4), Table.row(9), Table.row(-2), Table.row(1.5));
  }
  return out;
}
try {
  console.log(early(6), early(8));
} catch (error: any) {
  console.log(error.name);
}
const late = 100;
console.log(run(3).map(show).join(" "));
try {
  console.log(early(9), refuse(9));
} catch (error: any) {
  console.log(error.message);
}
swapped = (x: any): any => -x;
console.log(run(1).map(show).join(" "), calls);
