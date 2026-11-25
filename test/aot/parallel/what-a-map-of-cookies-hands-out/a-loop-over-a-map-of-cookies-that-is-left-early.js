// Nothing is written on the prototype of the iterators: a loop that is left early answers as in plain Bun.
const pairs = new Bun.CookieMap("a=1; b=2");
const steps = Object.getPrototypeOf(pairs.entries());
console.log(`${"return" in steps} ${typeof steps.next} ${Reflect.ownKeys(steps).length}`);
for (const [key] of pairs) {
  console.log(key);
  break;
}
const walked = pairs.entries();
for (const [key] of walked) {
  console.log(key);
  break;
}
console.log(`${[...walked]} ${[...pairs.keys()]}`);
