// Reads in front of the declaration.
const log: string[] = [];
function attempt(name: string, read: () => unknown) {
  try { log.push(name + "=" + JSON.stringify(read())); } catch (error) { log.push(name + ":" + (error as Error).constructor.name); }
}
function readAll(when: string) {
  attempt(when + " object", () => object.a);
  attempt(when + " list", () => list.length);
  attempt(when + " typeof", () => typeof object);
  attempt(when + " Klass", () => Klass.name);
  attempt(when + " made", () => made.v);
  attempt(when + " variable", () => variable);
  attempt(when + " enum", () => Enumeration.B);
  attempt(when + " nothing", () => String(nothing));
  attempt(when + " something", () => String(something && something.n));
  attempt(when + " none", () => String(none));
  attempt(when + " either", () => String(either));
}
function choose(n: number): { n: number } | undefined { return n > 2 ? { n } : undefined; }
function chooseNull(n: number): { n: number } | null { return n > 2 ? { n } : null; }
function chooseEither(n: number): { n: number } | null | undefined { return n > 2 ? { n } : n > 1 ? null : undefined; }
readAll("early");
const object = { a: 1 };
readAll("middle");
const list = [1, 2, 3];
class Klass { m() { return 1; } }
function make() { return { v: list.length }; }
const made = make();
var variable = { w: 1 };
enum Enumeration { A, B }
const nothing = choose(1);
const something = choose(3);
readAll("between");
const none = chooseNull(1);
const either = chooseEither(2);
readAll("late");
readAll("again");
console.log(log.join("\n"));
