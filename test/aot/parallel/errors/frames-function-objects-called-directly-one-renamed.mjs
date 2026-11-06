// Prints the names that stack frames show for function objects of one function, one of which has been given a displayName through a value that came back out of code made at run time: for each shape of a call whose callee the compiler can know.
const names = (stack, count) =>
  stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line => line.trim().replace(/ ?\(.*\)$/, "").replace(/^at /, ""))
    .join(" < ");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const rename = (f, name) => void (handedBack(f).displayName = name);

{
  const make = () => function plain() { return new Error("x").stack; };
  const a = make(), b = make();
  rename(b, "renamed");
  function callsOne(f) { return names(f(), 2); }
  console.log("a call |", callsOne(a), "|", callsOne(b), "|", callsOne(a));
}
{
  const make = () => function seldom(value) { if (value === undefined) throw new Error("x"); return value + 1; };
  const a = make(), b = make();
  rename(a, "renamed");
  function sum(f, list) {
    let total = 0;
    for (const value of list) total += f(value);
    return total;
  }
  const shown = f => { try { return sum(f, [1, 2, 3, undefined]); } catch (error) { return names(error.stack, 2); } };
  console.log("a throw off the way |", sum(a, [1, 2]), shown(a), "|", shown(b), "|", shown(a));
}
{
  const makeInner = () => function inner() { return new Error("x").stack; };
  const makeOuter = inner => function outer() { return inner() + ""; };
  const i1 = makeInner(), i2 = makeInner();
  const o1 = makeOuter(i1), o2 = makeOuter(i2);
  rename(i2, "renamedInner");
  rename(o1, "renamedOuter");
  function callsBoth(f) { return names(f(), 3); }
  console.log("a call in a call |", callsBoth(o1), "|", callsBoth(o2), "|", callsBoth(o1));
}
{
  const makeHolder = () => ({ read: function read() { return new Error("x").stack; } });
  const h1 = makeHolder(), h2 = makeHolder();
  rename(h1.read, "renamed");
  function reads(holder) { return names(holder.read(), 2); }
  console.log("out of a field |", reads(h1), "|", reads(h2), "|", reads(h1));
}
{
  function makeFamily() {
    function leaf() { return new Error("x").stack; }
    function middle() { return leaf() + ""; }
    function top() { return names(middle(), 3); }
    return { leaf, middle, top };
  }
  const f1 = makeFamily(), f2 = makeFamily();
  rename(f1.leaf, "renamedLeaf");
  rename(f2.middle, "renamedMiddle");
  console.log("siblings |", f1.top(), "|", f2.top(), "|", f1.top());
}
{
  const make = () => function last(next) { "use strict"; return next ? next() : new Error("x").stack; };
  const a = make(), b = make(), c = make();
  rename(b, "renamed");
  const shown = [];
  const turns = [[a, b], [b, a], [a, undefined], [b, undefined], [c, b], [b, c], [c, undefined]];
  for (const [first, next] of turns) shown.push(names(first(next), 1));
  console.log("left by a tail call |", shown.join(" | "));
}
{
  const make = () => function during(then) { then(); return new Error("x").stack; };
  const a = make(), b = make();
  function callsOne(f, then) { return names(f(then), 2); }
  console.log("renamed meanwhile |", callsOne(a, () => rename(a, "itself")), "|", callsOne(b, () => {}), "|", callsOne(a, () => {}));
}
