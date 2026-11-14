// A loop converts one text in every iteration: the text of a field, of a parameter, of a variable; the loop stores another one, deletes it, replaces its holder; what is no text runs its valueOf in every iteration.
const lines: string[] = [];
const show = (value: unknown): string => (Object.is(value, -0) ? "-0" : String(value));
const values: { level?: any } = { level: process.env.NOT_SET ?? "3" };
let holder: { level?: any } = { level: "5" };
function ofModule(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum * 31 + i * +values.level) % 1000003;
  return sum;
}
function ofParameter(n: number, text: any): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum * 31 + i * +text) % 1000003;
  return sum;
}
function stored(n: number, text: any): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = (sum * 31 + i * +values.level) % 1000003;
    if (i === 7) values.level = text;
  }
  return sum;
}
function replaced(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = (sum * 31 + i * +holder.level) % 1000003;
    if (i === 9) holder = { level: "0.5" };
  }
  holder = { level: "5" };
  return sum;
}
function called(n: number, change: (i: number) => void): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = (sum * 31 + i * +values.level) % 1000003;
    change(i);
  }
  return sum;
}
let runs = 0;
const object = {
  valueOf() {
    runs++;
    if (runs % 20 === 5) values.level = "11";
    return 2;
  },
};
const texts: any[] = ["3", " 7 ", "0", "65535", "65536", "-1", "0.5", "", "x", "1e3", "0x1f", "9".repeat(20), "Infinity", 4, 0.25, undefined, null, true, object, [6], { toString: () => "8" }];
for (let turn = 0; turn < 3; turn++)
  for (const text of texts) {
    values.level = text;
    lines.push(show(ofModule(40)));
    values.level = text;
    lines.push(show(ofParameter(40, text)), show(ofModule(0)), show(stored(40, turn ? "2" : 0.5)));
    values.level = text;
    lines.push(show(called(40, i => { if (i === 5) values.level = "6"; if (i === 12) delete values.level; if (i === 20) values.level = 3; })));
    lines.push(show(replaced(40)), String(runs));
  }
for (const wrong of [5n, Symbol("s"), { valueOf() { throw new RangeError("v"); } }]) {
  values.level = wrong;
  try { lines.push(show(ofModule(3))); } catch (error) { lines.push((error as Error).constructor.name); }
  try { lines.push(show(ofParameter(3, wrong))); } catch (error) { lines.push((error as Error).constructor.name); }
  lines.push(show(ofModule(0)));
}
const joined = ["1", "2"].join("");
let sum = 0;
for (let i = 0; i < 100; i++) sum = (sum * 33 + i * +joined) % 65521;
console.log(lines.join() + " " + sum);
