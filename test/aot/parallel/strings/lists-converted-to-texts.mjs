// Lists converted by sums and templates: elements of every kind, lists changed before they are converted, lists with members of their own.
const show = v => (typeof v === "string" ? JSON.stringify(v) : String(v));
const log = [];
class Point {
  constructor(x) {
    this.x = x;
    this.y = "y" + x;
  }
}
function keys(o) {
  return "keys " + Object.keys(o) + ` ${Object.keys(o)} ` + (Object.keys(o) + 1);
}
function plain(x, s) {
  return ["p" + [x, s], [x, s] + "p", `${[x, s]}|${[]}|${[s]}`, x + [x], [x] + [s], "" + [null, undefined, true, -0, NaN, x], "n" + [[x, s], s], "" + [, x]];
}
function changed(x, s) {
  const a = [x, s];
  a.push(1);
  const b = [x, s];
  b[0] = "changed";
  const c = [x, s];
  c.length = 1;
  const d = [x, s];
  d.toString = () => "own";
  const e = [x, s];
  e.join = () => "joined";
  const f = [x, s];
  f[Symbol.toPrimitive] = hint => hint;
  const g = [x, { toString() { log.push("t"); return "o"; } }];
  return ["a" + a, "b" + b, "c" + c, "d" + d, "e" + e, "f" + f + `${f}`, "g" + g + log.splice(0).length];
}
function rounds(n, s) {
  let text = "";
  const list = [s, n];
  for (let i = 0; i < n; i++) {
    text += list + ";";
    if (i === 1) list[1] = i;
  }
  return text;
}
for (let round = 0; round < 3; round++) {
  console.log(keys(new Point(round)), keys({}), keys([7, 8]));
  for (const [x, s] of [[1, "s"], [-0, ""], [0.5, "a,b"], [NaN, "€"]]) {
    console.log(plain(x, s).map(show).join(" "));
    console.log(changed(x, s).map(show).join(" "));
  }
  console.log(rounds(3, "r"));
  try {
    console.log("q" + [Symbol("q")]);
  } catch (error) {
    console.log(error.name);
  }
}
