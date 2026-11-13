// A text that grows by three steps out of twenty-eight, every ordered triple, each step once or in a loop of forty turns, and what a
// program can see of the text afterwards: its length, its units, whether it equals a copy made another way, and its use as a key.
import type { Cell } from "./cells";

const steps: Record<string, string> = {
  a: `s += "a";`,
  latin: `s += "\\u00e9";`,
  wide: `s += "\\u20ac";`,
  pair: `s += "\\u{1F600}";`,
  high: `s += "\\ud83d";`,
  low: `s += "\\ude00";`,
  zero: `s += "\\0";`,
  empty: `s += "";`,
  one: `s += 1;`,
  half: `s += 1.5;`,
  "minus zero": `s += -0;`,
  large: `s += 1e21;`,
  null: `s += null;`,
  undefined: `s += undefined;`,
  true: `s += true;`,
  big: `s += 10n;`,
  list: `s += [1, [2, 3]];`,
  object: `s += { toString() { return "<" + s.length + ">"; } };`,
  itself: `s += s.length < 4000 ? s : "!";`,
  "in front": `s = "x" + s;`,
  length: `s = s + s.length;`,
  part: `s += s.slice(1, 3);`,
  template: "s = `${s}-${s.length}`;",
  concat: `s = s.concat("z", 2);`,
  padded: `s = s.padEnd(s.length + 2, "\\u00e9p");`,
  joined: `s = [s, "j"].join("");`,
  upper: `s = s.toUpperCase();`,
  cut: `s = s.slice(0, -1);`,
};

export const helpers = `function units(s) { let sum = 0; for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) | 0; return sum; }
function copyOf(s) { let units = []; for (let i = 0; i < s.length; i++) units.push(s.charCodeAt(i)); let copy = ""; for (let i = 0; i < units.length; i += 1000) copy += String.fromCharCode(...units.slice(i, i + 1000)); return copy; }
`;
export const call = `try { run(); } catch (e) { log("threw " + e.name); }`;

export function cells(turns: string): Cell[] {
  const all: Cell[] = [];
  const names = Object.keys(steps);
  const done = (step: string) =>
    turns === "1" ? steps[step] : `for (let i = 0; i < ${turns}; i++) { ${steps[step]} }`;
  for (const x of names)
    for (const y of names)
      for (const z of names) {
        const id = `s${turns}x${all.length + 1}`;
        all.push({
          id,
          what: `${turns} | ${x} . ${y} . ${z}`,
          text: `function ${id}() { let s = ""; ${done(x)} log(s.length); ${done(y)} ${done(z)} log(s.length + " " + units(s) + " " + (s === copyOf(s)) + " " + ({ [s]: 1 })[copyOf(s)] + " " + new Map([[s, 2]]).get(copyOf(s)) + " " + s.indexOf("a") + " " + s.lastIndexOf("\\u00e9") + " " + (s < "m") + " " + units(JSON.stringify(s)) + " " + units(s.slice(-6)) + " " + [...s].length); }`,
        });
      }
  return all;
}
