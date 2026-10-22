import { callBack, count, Dog, fail, flag, isNumber, label, Level, limit, list, mutable, nothing, point, spoil, step, takes, version, wrap } from "./library.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

function total(numbers: number[]): number {
  let result = 0;
  for (let i = 0; i < numbers.length; i++) result += numbers[i];
  return result;
}

class Holder {
  n = count();
  s = label();
  p = point();
  next(): number {
    return this.n + 1;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab") + sum({ x: i, y: 1 }) + total([i]);
console.log("2000 honest rounds: " + warm);

attempt("a number", () => [count(), typeof count(), count() + 1, count() * 2, plusOne(count()), [0, 1, 2, 3, 4, 5, 6, 7][count()]]);
attempt("a number in a local, a list and a map", () => {
  const n: number = count();
  const numbers: number[] = [1, count()];
  const map = new Map<string, number>([["k", count()]]);
  return [n + 1, total(numbers), (map.get("k") ?? 0) + 1];
});
attempt("a text", () => [label(), typeof label(), label() + "!", label() + 1]);
attempt("the size of a text", () => size(label()));
attempt("a point", () => [point().x, point().x + point().y, sum(point()), Object.keys(point()).join(), JSON.stringify(point())]);
attempt("a list", () => [total(list()), list().map(plusOne), list().length]);
attempt("a function", () => [step()(1), step()(1) + 1, [1, 2].map(step())]);
attempt("a truth", () => [flag() === false, flag() === true, flag() ? "truthy" : "falsy", typeof flag()]);
attempt("nothing", () => [nothing(), nothing() + 1, plusOne(nothing())]);
attempt("constants", () => [limit, limit + 1, plusOne(limit), version, version === 3, version + 1]);
attempt("a variable", () => {
  const before = mutable + 1;
  spoil();
  return [before, mutable, mutable + 1, plusOne(mutable)];
});
attempt("fields of a holder", () => {
  const holder = new Holder();
  return [holder.next(), holder.s + "!", sum(holder.p), JSON.stringify(holder)];
});
attempt("a class", () => {
  const dog = new Dog("rex");
  return [dog.name, dog.name + "!", dog.legs, dog.legs + 1, dog.bark(), dog.bark() + 1, Dog.kinds + 1, JSON.stringify(dog)];
});
attempt("the size of a field", () => size(new Dog("rex").name));
attempt("a subclass", () => {
  class Puppy extends Dog {
    small = true;
    legsPlusOne(): number {
      return this.legs + 1;
    }
  }
  const puppy = new Puppy("p");
  return [puppy.legsPlusOne(), puppy.small, Object.keys(puppy).join()];
});
attempt("operands", () => [takes(1, "s"), takes(1.5, "")]);
attempt("a callback", () => [callBack(plusOne), callBack(n => n * 2), callBack(Math.abs)]);
attempt("a template", () => [wrap(5), typeof wrap(5), wrap("ab").length]);
attempt("a template, a method of lists", () => wrap(5).map(plusOne));
attempt("a guard", () => {
  const values: unknown[] = [1, "1", null, [1]];
  return values.map(v => (isNumber(v) ? v + 1 : "no number"));
});
attempt("never", () => {
  fail();
  return "the statement after the call ran";
});
attempt("never narrows", () => {
  const n: number | undefined = [1][1];
  if (n === undefined) fail();
  return n + 1;
});
attempt("an enum", () => [Level.Low, Level.Low + "!", plusOne(Level.High)]);
