// Fields that only ever hold a few strings written in the program. The compiler may keep the number of such a string in the slot, or its cell.
// Whichever it keeps, a string that arrives as a cell (out of a list, out of a call, put together at run time) compares and reads as the written one.
const lines = [];
const values = ["low", "mid", "high", "low"];
const halves = [["l", "ow"], ["mi", "d"], ["hi", "gh"]];

// Stored out of a list, compared with written strings.
const row = { level: "low", n: 0 };
function gradeOf(i) {
  row.level = values[i & 3];
  return row.level === "low" ? 10 : row.level === "mid" ? 20 : 30;
}
// Stored as a string put together at run time, which is no cell of a written string.
const joined = { level: "mid" };
function gradeOfJoined(i) {
  const [head, tail] = halves[i % 3];
  joined.level = head + tail;
  return joined.level === "low" ? 1 : joined.level === "mid" ? 2 : joined.level !== "high" ? 3 : 4;
}
// Written strings alone, read as strings.
const rows = [{ n: 1, s: "a" }, { n: 2, s: "bb" }, { n: 3, s: "ccc" }, { n: 4, s: "dddd" }, { n: 5, s: "" }];
function lengthOf(i) {
  const r = rows[i % 5];
  return r.n * 10 + r.s.length;
}
function textOf(i) {
  const r = rows[i % 5];
  return `${r.s}|${r.s + r.s}|${typeof r.s}|${r.s ? "filled" : "empty"}|${r.s.toUpperCase()}|${r.s[0]}|${r.s.charCodeAt(1)}`;
}
// Written strings stored in a function that runs often, and a switch.
class Light {
  constructor() { this.color = "red"; }
  step() {
    switch (this.color) {
      case "red": this.color = "green"; return 1;
      case "green": this.color = "yellow"; return 2;
      default: this.color = "red"; return 3;
    }
  }
}
// One field gets both: written strings and cells, and is handed on.
const mixed = { kind: "first", other: "second" };
function handOn(i) {
  mixed.kind = i & 1 ? "first" : values[i & 3];
  mixed.other = mixed.kind;
  return [mixed.kind, mixed.other, mixed.kind === mixed.other, { [mixed.kind]: i }, JSON.stringify(mixed)];
}
// The field is left without a string.
const optional = { tag: "on" };
function toggle(i) {
  optional.tag = i % 3 === 0 ? undefined : i % 3 === 1 ? "on" : values[2];
  return optional.tag === "on" ? "on" : optional.tag === undefined ? "none" : optional.tag.length;
}
const light = new Light();
const functions = [gradeOf, gradeOfJoined, lengthOf, textOf, () => light.step(), handOn, toggle];
for (let i = 0; i < 12; i++) lines.push(functions.map(f => JSON.stringify(f(i))).join(" "));
lines.push(JSON.stringify([row, joined, rows, light, mixed, optional]), Object.keys(row).join(), Object.values(rows[3]).join());
console.log(lines.join("\n"));
