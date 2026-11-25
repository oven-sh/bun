import { value, count } from "./a.mjs";
export function loopOver(n, at, act) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    if (i === at) act(i);
    try { seen.push(value + (count | 0)); } catch (error) { seen.push(error.constructor.name); }
  }
  return seen.join(" ");
}
export function sums(n, at, act) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i === at) act(i);
    sum += value;
  }
  return sum;
}
export function unguarded(n) { let sum = 0; for (let i = 0; i < n; i++) sum += value; return sum; }
let early;
try { early = unguarded(5); } catch (error) { early = error.constructor.name; }
globalThis.say("early " + early);
early = loopOver(6, 3, () => globalThis.hook());
globalThis.say("hooked " + early);
export { early };
