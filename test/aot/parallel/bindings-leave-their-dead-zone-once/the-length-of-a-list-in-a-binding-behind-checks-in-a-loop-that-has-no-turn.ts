// What is read off the binding behind the checks is the length of a list.
function measure(flag: boolean, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) { total += flag ? list.length : list.length + 1; total += list.length; }
  return total;
}
const yes = Boolean(JSON.parse("1")); const none = Number(JSON.parse("0")); const two = Number(JSON.parse("2"));
console.log("early", measure(yes, none));
let list = [1, 2, 3].map((x) => x * two);
console.log("filled", measure(yes, two), measure(!yes, two));
list = list.concat(list);
console.log("again", measure(yes, two));
