// A typed class without a constructor of its own extends a class that untyped code made at run time, which extends others down to Error: what `new` makes, the stack it records, errors thrown part of the way down, `new.target`, many and no arguments.
import * as helper from "./default-constructor-of-a-typed-class-over-untyped-classes-helper.js";
const print = (s: unknown) => console.log(String(s));
const lines = (stack: string | undefined) => (stack ?? "").split("\n").map(line => /(?:^|at |new )(make|Base)[@ ]/.exec(line.trim())?.[1]).filter(name => name).join(" < ");
const untyped: any = helper;
class NotFound extends (untyped.tagged("NotFound") as new (...args: any[]) => Error & { id: number; _tag: string }) {}
class Deeper extends NotFound {}
class OverOrdinary extends (untyped.Plain as new (a: number, b: number) => { sum: number; target: string }) {}
class OverDerived extends (untyped.OverPlain as new (a: number, b: number) => { sum: number; target: string }) {}
function make(id: number) {
  return new NotFound({ id, message: "no such user" });
}
function outer(id: number) {
  return make(id);
}
for (let i = 0; i < 3; i++) {
  const error = outer(i);
  print([error instanceof NotFound, error instanceof Error, error.name, error.message, error.id, error._tag, Object.keys(error).join()].join(" "));
  print(lines(error.stack));
}
print(lines(new Deeper({ message: "deeper" }).stack));
print(new NotFound().message === "" ? "no arguments" : "?");
print(new NotFound({ message: "many" }, 1, 2, 3, 4, 5, 6, 7, 8, 9).message);
try {
  new NotFound({ fail: true });
} catch (e) {
  print((e as Error).name + ": " + lines((e as Error).stack));
}
print(untyped.seen.join(" "));
const ordinary = new OverOrdinary(1, 2);
const derived = new OverDerived(3, 4);
print([ordinary.sum, ordinary.target, derived.sum, derived.target, derived instanceof untyped.Plain].join(" "));
