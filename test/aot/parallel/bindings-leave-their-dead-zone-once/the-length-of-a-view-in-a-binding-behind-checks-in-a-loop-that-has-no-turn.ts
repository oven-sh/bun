// What is read off the binding behind the checks is the length of a view.
function measure(flag: boolean, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) { total += flag ? view.length : view.length + 1; total += view.length; }
  return total;
}
const yes = Boolean(JSON.parse("1")); const none = Number(JSON.parse("0")); const two = Number(JSON.parse("2"));
console.log("early", measure(yes, none));
let view = new Uint8Array(two + 3);
console.log("filled", measure(yes, two), measure(!yes, two));
view = new Uint8Array(two);
console.log("again", measure(yes, two));
