// Interfaces that a Date and a RegExp satisfy
interface Timed {
  getTime(): number;
}
interface Sourced {
  source: string;
  flags: string;
}
function time(v: Timed): string {
  return v.getTime() + "|" + (v instanceof Date) + "|" + Object.prototype.toString.call(v);
}
function source(v: Sourced): string {
  return v.source + "|" + v.flags + "|" + (v instanceof RegExp) + "|" + Object.keys(v).join();
}
const a: Timed[] = [
  {
    getTime() {
      return 5;
    },
  },
  new Date(7),
];
const b: Sourced[] = [{ source: "s", flags: "f" }, /x+/gi];
for (let round = 0; round < 3; round++) {
  for (const v of a) console.log(time(v));
  for (const v of b) console.log(source(v));
}
