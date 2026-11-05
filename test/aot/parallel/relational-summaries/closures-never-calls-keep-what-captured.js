// Closures that nobody ever calls, and that somebody keeps: what they have captured lives as long as they do.
const kept = [];
let slot = null;
const holder = { f: null };
function keep(f) {
  kept.push(f);
}
function pushed(p) {
  kept.push(() => p.n);
}
function inAVariable(p) {
  slot = () => p.n;
}
function returned(p) {
  return () => p.n;
}
function inAMemberOfAParameter(p, o) {
  o.f = () => p.n;
}
function insideAnotherClosure(p) {
  const g = () => p.n;
  kept.push(() => g);
}
function thrown(p) {
  throw () => p.n;
}
function handedToAHelper(p) {
  keep(() => p.n);
}
function inAnObjectThatIsKept(p) {
  kept.push({ f: () => p.n });
}
function inAnArrayThatIsReturned(p) {
  return [() => p.n];
}
function dies(p) {
  const g = () => p.n;
}
const names = ["pushed", "inAVariable", "returned", "inAMemberOfAParameter", "insideAnotherClosure", "thrown", "handedToAHelper", "inAnObjectThatIsKept", "inAnArrayThatIsReturned", "dies"];
const watched = names.map(() => []);
const results = [];
function ask() {
  for (let i = 0; i < 300; i++) {
    const make = k => {
      const p = { n: i };
      watched[k].push(new WeakRef(p));
      return p;
    };
    pushed(make(0));
    inAVariable(make(1));
    results.push(returned(make(2)));
    const o = { f: null };
    inAMemberOfAParameter(make(3), o);
    results.push(o);
    insideAnotherClosure(make(4));
    try {
      thrown(make(5));
    } catch (e) {
      results.push(e);
    }
    handedToAHelper(make(6));
    inAnObjectThatIsKept(make(7));
    results.push(inAnArrayThatIsReturned(make(8)));
    dies(make(9));
  }
}
ask();
await new Promise(resolve => setTimeout(resolve, 1));
Bun.gc(true);
await new Promise(resolve => setTimeout(resolve, 1));
Bun.gc(true);
// The collector scans the stack conservatively: a few may be alive by chance.
const few = n => (n < 20 ? "none or by chance" : n === 300 ? "all" : "some");
names.forEach((name, k) => console.log(name + ": " + few(watched[k].filter(r => r.deref() !== undefined).length)));
console.log(kept.length, results.length, typeof slot, holder.f);
