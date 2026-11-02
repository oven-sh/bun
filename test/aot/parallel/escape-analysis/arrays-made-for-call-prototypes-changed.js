// A callee reads an array that was made for the call, hands its elements to a function of the program, and reads it again. That function tries everything that would make arrays inherit elements or stop being ordinary arrays.
// --aot locks Array.prototype and Object.prototype, so each attempt throws or changes nothing, which is what the .expected.txt shows; plain Bun lets them through.
// Flags: --aot-disable=InlineCalls
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
/* Output:
0: {0}s0undefinedundefined2 TypeError{0}s0 {0}s0undefinedundefined2 {0}s0 2
0: TypeError{0}r0 {0}r0undefined2
1: {1}s1undefinedundefined2 TypeError{1}s1 {1}s1undefinedundefined2 {1}s1 2
1: TypeError{1}r1 {1}r1undefined2
2: {2}s2undefinedundefined2 TypeError{2}s2 {2}s2undefinedundefined2 {2}s2 2
2: TypeError{2}r2 {2}r2undefined2
3: {3}s3undefinedundefined2 TypeError{3}s3 {3}s3undefinedundefined2 {3}s3 2
3: TypeError{3}r3 {3}r3undefined2
4: {4}s4undefinedundefined2 TypeError{4}s4 {4}s4undefinedundefined2 {4}s4 2
4: TypeError{4}r4 {4}r4undefined2
5: {5}s5undefinedundefined2 TypeError{5}s5 {5}s5undefinedundefined2 {5}s5 2
5: TypeError{5}r5 {5}r5undefined2
6: {6}s6undefinedundefined2 TypeError{6}s6 {6}s6undefinedundefined2 {6}s6 2
6: TypeError{6}r6 {6}r6undefined2
7: {7}s7undefinedundefined2 TypeError{7}s7 {7}s7undefinedundefined2 {7}s7 2
7: TypeError{7}r7 {7}r7undefined2
8: {8}s8undefinedundefined2 TypeError{8}s8 {8}s8undefinedundefined2 {8}s8 2
8: TypeError{8}r8 {8}r8undefined2
9: {9}s9undefinedundefined2 TypeError{9}s9 {9}s9undefinedundefined2 {9}s9 2
9: TypeError{9}r9 {9}r9undefined2
*/
