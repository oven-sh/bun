// What is asked of the binding behind the checks is its class.
class Crate { weight = 3; }
class Barrel { volume = 4; }
function measure(flag: boolean, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) { total += flag ? (thing instanceof Crate ? 1 : 2) : (thing instanceof Crate ? 3 : 4); total += thing instanceof Barrel ? 10 : 20; total += typeof thing === "object" ? 100 : 200; }
  return total;
}
const yes = Boolean(JSON.parse("1")); const none = Number(JSON.parse("0")); const two = Number(JSON.parse("2"));
console.log("early", measure(yes, none));
let thing: Crate | Barrel = yes ? new Crate() : new Barrel();
console.log("filled", measure(yes, two), measure(!yes, two));
thing = new Barrel();
console.log("again", measure(yes, two));
