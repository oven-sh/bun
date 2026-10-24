// Each function has one call of Object.create. The first object that the call is handed is a literal, null, a proxy, a function, an array, the prototype object of a class, of a constructor
// function or of a built-in class, an object that Object.create made, a frozen literal, or no object at all; later calls are handed the others.
const log = [];
class Shape { area() { return "area of " + this.name; } get name2() { return this.name + "!"; } }
function Old() {}
Old.prototype.area = function () { return "old area of " + this.name; };
const literal = { area() { return "literal area of " + this.name; }, get name2() { return this.name + "?"; } };
const handed = {
  literal: () => literal,
  nothing: () => null,
  proxy: () => new Proxy(literal, { get(target, key, receiver) { return key === "area" ? () => "trapped" : Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push("set trap " + String(key)); return Reflect.set(target, key, value, receiver); } }),
  function: () => function named() {},
  array: () => [1, 2, 3],
  classPrototype: () => Shape.prototype,
  oldPrototype: () => Old.prototype,
  builtinPrototype: () => Map.prototype,
  created: () => Object.create(literal),
  frozen: () => Object.freeze({ area() { return "frozen area"; }, name: "frozen name" }),
  number: () => 7,
  undefined: () => undefined,
  string: () => "text",
};
const makers = [
  above => { const made = Object.create(above); made.name = "a"; made.extra = 1; return made; },
  above => { const made = Object.create(above); made.name = "b"; made.extra = 2; return made; },
  above => { const made = Object.create(above); made.name = "c"; made.extra = 3; return made; },
  above => { const made = Object.create(above); made.name = "d"; made.extra = 4; return made; },
  above => { const made = Object.create(above); made.name = "e"; made.extra = 5; return made; },
  above => { const made = Object.create(above); made.name = "f"; made.extra = 6; return made; },
  above => { const made = Object.create(above); made.name = "g"; made.extra = 7; return made; },
  above => { const made = Object.create(above); made.name = "h"; made.extra = 8; return made; },
  above => { const made = Object.create(above); made.name = "i"; made.extra = 9; return made; },
  above => { const made = Object.create(above); made.name = "j"; made.extra = 10; return made; },
  above => { const made = Object.create(above); made.name = "k"; made.extra = 11; return made; },
  above => { const made = Object.create(above); made.name = "l"; made.extra = 12; return made; },
  above => { const made = Object.create(above); made.name = "m"; made.extra = 13; return made; },
];
function look(made) {
  let answer = typeof made.area === "function" ? made.area() : String(made.area);
  answer += " | " + made.name + " | " + made.name2 + " | " + made.extra + " | " + made.length + " | " + Object.keys(made).join();
  answer += " | " + (Object.getPrototypeOf(made) === null ? "null" : typeof Object.getPrototypeOf(made)) + " | " + (made instanceof Shape) + (made instanceof Old) + " | " + typeof made.toString;
  return answer;
}
const names = Object.keys(handed);
makers.forEach((make, first) => {
  for (let step = 0; step < names.length * 2; step++) {
    const name = names[(first + step) % names.length];
    try {
      const above = handed[name]();
      const made = make(above);
      log.push(first + " " + name + ": " + look(made) + " | " + (Object.getPrototypeOf(made) === above));
    } catch (error) {
      log.push(first + " " + name + ": " + error.constructor.name + ": " + error.message);
    }
  }
});
console.log(log.join("\n"));
