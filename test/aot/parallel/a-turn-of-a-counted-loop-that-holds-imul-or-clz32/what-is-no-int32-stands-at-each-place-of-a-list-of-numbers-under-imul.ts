// STATISTIC: UnrolledLoopsEmitted >= 1
// The list is declared a list of numbers and its turns are laid out. One value that is no int32 stands at each of the first ten places in turn:
// the turn that meets it leaves the turns laid out and runs again as written: nothing is summed twice, no conversion runs twice.
function mix(list: number[]): number {
  let hash = -3;
  for (let at = 0; at < list.length; at++) hash = Math.imul(hash, 31) + Math.imul(list[at], list[at]) | 0;
  return hash;
}

const source = JSON.stringify(Array.from({ length: 24 }, (_, at) => at * 65537 - 40000));
let calls = 0;
const odd: [string, () => unknown][] = [
  ["a fraction", () => 2.75], ["no number", () => NaN], ["minus zero", () => -0], ["two to the 31st", () => 2147483648], ["two to the 53rd", () => 9007199254740992],
  ["past 32 bits", () => 4294967301], ["endless", () => -Infinity], ["undefined", () => undefined], ["null", () => null], ["a text", () => "12"], ["a boolean", () => true],
  ["an object", () => ({ valueOf() { calls++; return 5; } })],
];
for (const [name, make] of odd) {
  const hashes: number[] = [];
  const before = calls;
  for (let place = 0; place < 10; place++) {
    const list = JSON.parse(source) as number[];
    (list as unknown[])[place] = make();
    hashes.push(mix(list));
  }
  console.log(name, hashes.join(" "), "conversions", calls - before);
}
const holes: number[] = [];
for (let place = 0; place < 10; place++) {
  const list = JSON.parse(source) as number[];
  delete list[place];
  holes.push(mix(list));
}
console.log("a hole", holes.join(" "));
