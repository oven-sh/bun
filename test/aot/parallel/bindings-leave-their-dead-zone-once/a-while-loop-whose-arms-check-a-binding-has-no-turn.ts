// A while loop, and the arms of an if in place of a conditional expression.
function measure(flag: boolean, turns: number): number {
  let total = 0, i = 0;
  while (i < turns) { if (flag) total += text.length; else total -= text.length; total += text.length * 2; i++; }
  return total;
}
const yes = Boolean(JSON.parse("1")); const none = Number(JSON.parse("0")); const two = Number(JSON.parse("2"));
console.log("early", measure(yes, none));
let text = ["ab", "cd"].join("");
console.log("filled", measure(yes, two), measure(!yes, two));
text += "e";
console.log("again", measure(yes, two));
