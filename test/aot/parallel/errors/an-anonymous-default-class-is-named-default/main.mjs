// The two errors that name a class call `export default class {}` default, as its name property does. An executable names the class as plain Bun does.
import AnonymousClass from "./anonymous-class.mjs";
import DerivedClass from "./derived-class.mjs";
const messageOf = run => {
  try {
    run();
  } catch (error) {
    return error.message;
  }
};
console.log("name |", AnonymousClass.name, "|", DerivedClass.name);
console.log(
  "called without new |",
  messageOf(() => AnonymousClass()),
);
console.log(
  "a constructor that returns a number |",
  messageOf(() => new DerivedClass()),
);
