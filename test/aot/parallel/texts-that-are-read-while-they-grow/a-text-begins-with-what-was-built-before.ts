// COUNT: operation:operationAOTStackStringBuilderToString >= 50
// The outer turn begins its text with the last result, and the inner turns read it as it grows.
function weave(rounds: number, width: number): string {
  let all = "";
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    let line = all;
    for (let at = 0; at < width; at++) {
      line += (round + at) % 3 ? "·" : "-";
      sum = (sum + line.length + line.charCodeAt(line.length - 1)) | 0;
    }
    all = line + "\n";
  }
  return sum + ":" + all;
}
const woven = weave(12, 9);
console.log(woven.length, JSON.stringify(woven.slice(0, 30)), JSON.stringify(woven.slice(-12)));
