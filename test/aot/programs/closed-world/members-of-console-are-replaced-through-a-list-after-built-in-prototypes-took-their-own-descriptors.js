// One function defines a member of two built-in prototypes again from the member's own descriptor. Then members of console are replaced through a list of objects and keys, called, and put back.
function defineAgain(object, key) {
  return Reflect.defineProperty(object, key, Object.getOwnPropertyDescriptor(object, key));
}
const print = console.log.bind(console);
print(defineAgain(Array.prototype, "push"), defineAgain(Error.prototype, "toString"));
const members = [
  [console, "log", () => typeof console.log("to the replacement")],
  [console, "info", () => typeof console.info("to the replacement")],
];
for (const way of ["assigned", "defined", "defined as a getter"])
  for (const [holder, key, call] of members) {
    const was = Reflect.getOwnPropertyDescriptor(holder, key);
    let calls = 0;
    const replacement = () => {
      calls++;
      return "replaced";
    };
    let outcome;
    try {
      if (way === "assigned") outcome = (holder[key] = replacement) === replacement;
      else if (way === "defined") outcome = Reflect.defineProperty(holder, key, { value: replacement, configurable: true, writable: true });
      else outcome = Reflect.defineProperty(holder, key, { get: () => replacement, configurable: true });
    } catch (error) {
      outcome = error.name;
    }
    const answer = call();
    Reflect.defineProperty(holder, key, was);
    print(way, key, outcome, holder[key] === was.value, calls, answer);
  }
print([..."ab"].concat([1, 2].map(n => n + 1)).join(), new Error("text").toString());
