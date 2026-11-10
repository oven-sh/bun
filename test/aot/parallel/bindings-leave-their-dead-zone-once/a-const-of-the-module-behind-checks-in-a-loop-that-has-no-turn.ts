// The checks of a module's `const` stand in the arms of a loop, and a third read follows them without one. The function is called for no turn in front of the declaration.
function measure(flag: boolean, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) { total += flag ? text.length : text.length + 1; total += text.length; }
  return total;
}
const yes = Boolean(JSON.parse("1")); const none = Number(JSON.parse("0")); const two = Number(JSON.parse("2"));
console.log("early", measure(yes, none));
const text = ["ab", "cd"].join("");
console.log("filled", measure(yes, two), measure(!yes, two));
