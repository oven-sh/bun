// A read-only property or an accessor at an index of a function leaves the arrays of the program as they are: nothing inherits from it.
const lines: string[] = [];
const say = (what: string, value: unknown) => lines.push(what + ": " + String(value));
const outcome = (run: () => void) => {
  try {
    run();
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
function declared() {}
const arrow = () => {};
const bound = declared.bind(null);
class WithStatic {
  static made() {}
}
for (const [name, f] of [
  ["declared", declared],
  ["arrow", arrow],
  ["bound", bound],
  ["static method", WithStatic.made],
] as [string, any][]) {
  Object.defineProperty(f, 0, { value: name, writable: false, configurable: true });
  Object.defineProperty(f, 1, { get: () => name + " by a getter", configurable: true });
  say(name + " store", outcome(() => (f[0] = "no")));
  say(name + " 0", f[0]);
  say(name + " 1", f[1]);
  say(name + " keys", Object.getOwnPropertyNames(f).filter(key => key === "0" || key === "1").join());
}
const numbers: number[] = [];
for (let i = 0; i < 100; i++) numbers.push(i);
numbers[200] = 1;
say("arrays", numbers.length + " " + numbers[3] + " " + numbers[150]);
say("others", [1, , 3][1]);
console.log(lines.join("\n"));
