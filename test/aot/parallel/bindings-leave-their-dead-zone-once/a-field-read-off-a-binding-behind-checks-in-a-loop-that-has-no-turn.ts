// What is read off the binding behind the checks is a field of a record: the load would go through the empty word.
type Crate = { weight: number; label?: string };
function measure(flag: boolean, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) { total += flag ? crate.weight : crate.weight + 1; total += crate.weight; if (crate.label !== undefined) total += 100; }
  return total;
}
const yes = Boolean(JSON.parse("1")); const none = Number(JSON.parse("0")); const two = Number(JSON.parse("2"));
console.log("early", measure(yes, none));
let crate: Crate = { weight: two * 2 };
console.log("filled", measure(yes, two), measure(!yes, two));
crate = { weight: 1, label: "x" };
console.log("again", measure(yes, two));
