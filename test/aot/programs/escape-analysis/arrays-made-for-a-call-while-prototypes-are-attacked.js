// A callee reads an array that was made for the call, hands its elements to a function of the program, and reads it again. That function tries everything that would make arrays inherit elements or stop being ordinary arrays.
// --aot locks Array.prototype and Object.prototype, so each attempt throws or changes nothing, which is what the .expected.txt shows; plain Bun lets them through.
const lines = [];
const box = n => ({ n });
const show = value => (typeof value === "object" && value !== null ? "{" + value.n + "}" : String(value));

const attacks = [
  () => { Object.prototype[5] = "from Object.prototype"; },
  () => { Array.prototype[5] = "from Array.prototype"; },
  () => { Object.defineProperty(Array.prototype, 1, { get() { return "getter"; }, configurable: true }); },
  () => { Object.defineProperty(Object.prototype, "6", { value: "defined", configurable: true }); },
  () => { Object.setPrototypeOf(Array.prototype, { 5: "new parent" }); },
  () => { Array.prototype.__proto__ = null; },
  () => { Object.defineProperty(Array.prototype, "length", { value: 9 }); },
  () => { Array.prototype.push("pushed onto the prototype"); },
  () => { Array.prototype[Symbol.iterator] = function* () { yield "replaced"; }; },
  () => { delete Array.prototype[Symbol.iterator]; },
];

function tries(attack) {
  try {
    attack();
    return "went through";
  } catch (error) {
    return error.constructor.name;
  }
}

function attackedBetweenReads(list, depth, run) {
  if (depth > 0) return attackedBetweenReads(list, depth - 1, run);
  const before = show(list[0]) + show(list[1]) + show(list[5]) + show(list[6]) + list.length;
  const outcome = run(...list);
  let walked = "";
  for (const value of list) walked += show(value);
  return before + " " + outcome + " " + show(list[0]) + show(list[1]) + show(list[5]) + show(list[6]) + list.length + " " + walked + " " + [...list].length;
}

function attackedRest(depth, run, ...rest) {
  if (depth > 0) return attackedRest(depth - 1, run, ...rest);
  const outcome = run.apply(null, rest);
  return outcome + " " + show(rest[0]) + show(rest[1]) + show(rest[5]) + rest.length;
}

for (let i = 0; i < attacks.length; i++) {
  const run = (first, second) => tries(attacks[i]) + show(first) + show(second);
  lines.push(i + ": " + attackedBetweenReads([box(i), "s" + i], 2, run));
  lines.push(i + ": " + attackedRest(2, run, box(i), "r" + i));
}
console.log(lines.join("\n"));
