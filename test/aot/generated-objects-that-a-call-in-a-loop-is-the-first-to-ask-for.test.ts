import { listed } from "./generated/objects-that-a-call-in-a-loop-is-the-first-to-ask-for";
import { generated } from "./generated/run-generated";

const askersOnceWrong = [
  "a function",
  "a function that ends in a call",
  "a method",
  "a static method",
  "a getter",
  "a closure",
  "Reflect.apply",
  "call",
  "apply",
  "a bound function",
];
const onceWrongAsTheyAre = [
  "a declared function or an arrow function and a closure come from a function, at the top of the file: call calls it; behind the loop it is compared with itself",
  "a declared function or an arrow function and a closure come from a function, at the top of the file: call calls it; behind the loop it is compared with itself, with types",
  "a declared function or an arrow function and a closure come from a getter, at the top of the file: a helper calls it twice; behind the loop it is compared with itself, with types",
];
const wasOnceWrong = (name: string) =>
  onceWrongAsTheyAre.includes(name) ||
  (name.endsWith(", in a build that counts the program as very large") &&
    askersOnceWrong.some(asker =>
      name.startsWith(
        `a declared function or an arrow function and a closure come from ${asker}, at the top of the file: a helper calls it twice; behind the loop it is compared with itself`,
      ),
    ));

generated(
  "objects that a call in a loop is the first to ask for",
  listed().map(({ name, flags, make }) => ({
    name,
    isAlwaysRun: wasOnceWrong(name),
    wasOnceWrong: wasOnceWrong(name),
    isOnlyCompiled: true,
    flags,
    make,
  })),
);
