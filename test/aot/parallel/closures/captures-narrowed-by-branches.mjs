// A function that runs once stores what its closures capture at the definition. A branch before the closure tells more of the value, and it does not tell it of a value that takes another way.
const words = new Int32Array([7, 2147483648, -7, 40, 0]);
function past(x) { if (x >= 2147483648 && x <= 2147483648) return () => x; return "not taken"; }
function fromFive(x) { if (x >= 5) return () => x; return "not taken"; }
function fromZeroUp(x) { if (x >= 0) return () => x; return "not taken"; }
function below(x) { if (x < 10) return () => x; return "not taken"; }
function taken(x) { if (x >= 0) return () => x; return "not taken"; }
function bothWays(x) { if (x >= 0) return () => x; return () => -x; }
function otherWay(x) { if (x >= 0) return () => x; return () => x - 1; }
function shared(x) { const low = () => x - 1; if (x >= 0) return [low, () => x + 1]; return [low]; }
function inLoop(list) {
  const x = list[2];
  let text = "";
  if (x >= 0) for (let i = 0; i < 3; i++) text += [1, 2].map(() => x).join() + ";";
  else text = "below zero";
  return text;
}
function local(list) {
  const x = list[2] + 3;
  if (x > 0 && x < 100) return [1, 2, 3].map(y => x * y).join();
  return "outside";
}
function nested(x) { if (x >= 1) return () => () => x; return "not taken"; }
function remainders(x) { const rest = x % 5; if (rest >= 0) return () => rest; return "negative"; }
function either(x) { if (typeof x === "number" && x >= 0) return () => x; return typeof x; }
function elements(list) { const x = list[0]; if (x !== undefined && x >= 0) return () => x; return "none"; }
async function waits(x) { if (x >= 0) { await 0; return () => x; } return "not taken"; }
function* steps(x) { if (x >= 0) yield () => x; yield "end"; }
const tell = value => (typeof value === "function" ? "closure of " + tell(value()) : String(value));
console.log(tell(past(words[1])), tell(fromFive(words[2])), tell(fromZeroUp(words[2])), tell(below(words[3])), tell(taken(words[0])));
console.log(tell(bothWays(words[2])), tell(otherWay(words[2])), shared(words[2]).map(tell).join(), inLoop(words), local(words), tell(nested(words[2])));
console.log(tell(remainders(words[2])), tell(either(words[2])), tell(elements(words.subarray(2))), tell(await waits(words[2])), [...steps(words[2])].map(tell).join());
