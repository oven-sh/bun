// Each TypeError of the rule can be caught, is a TypeError of the realm, and names the property it is about. Plain Bun throws none of them.
// Columns: kinds types. Elsewhere: not compared (under fields and wide the deletes, redefinitions and prototypes throw as stored, and the stores of another kind are done).
class Gauge { level: number = 1 }
interface Reading { level: number }
const makers: [string, () => any][] = [
  ["a class instance", () => new Gauge()],
  ["a literal", () => { const reading: Reading = { level: 1 }; return reading; }],
];
const operations: [string, (o: any) => unknown][] = [
  ["delete", o => delete o.level],
  ["a getter", o => Object.defineProperty(o, "level", { get() { return 7; } })],
  ["a store of another kind", o => { o.level = "text"; }],
];
for (const [how, make] of makers) {
  for (const [what, operation] of operations) {
    try {
      operation(make());
      console.log(how + ", " + what + ": done");
    } catch (e: any) {
      console.log(how + ", " + what + ":", e instanceof TypeError, Object.getPrototypeOf(e) === TypeError.prototype, e.message.includes("level"), typeof e.stack);
    }
  }
  try {
    Object.setPrototypeOf(make(), {});
    console.log(how + ", another prototype: done");
  } catch (e: any) {
    console.log(how + ", another prototype:", e instanceof TypeError, /prototype/i.test(e.message));
  }
}
