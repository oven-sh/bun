// Prints the names that stack frames show for functions that are declared side by side in a factory and call one another by their names. The factory runs several times, and a function object of one run gets a displayName through a value that came back out of code made at run time.
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
  function makeFamily() {
    function leaf() { return new Error("x").stack; }
    function top() { return names(leaf() + "", 2); }
    function give() { return leaf; }
    return { top, give };
  }
  const f1 = makeFamily(), f2 = makeFamily(), f3 = makeFamily();
  const before = [f1.top(), f2.top(), f3.top()];
  rename(f1.give(), "renamed");
  console.log("read as a value late |", before.join(" | "), "|", f1.top(), "|", f2.top(), "|", f3.top());
  rename(f2.give(), "other");
  console.log("then another |", f1.top(), "|", f2.top(), "|", f3.top());
}
{
  function makeFamily() {
    function last(next) { "use strict"; return next ? next() : new Error("x").stack; }
    function top(next) { return names(last(next) + "", 2); }
    return { last, top };
  }
  const f1 = makeFamily(), f2 = makeFamily();
  rename(f2.last, "renamed");
  console.log("left by a tail call |", f1.top(), "|", f1.top(f2.last), "|", f1.top(), "|", f2.top(f1.last), "|", f2.top());
}
{
  function makeFamily(depth) {
    function down(left) { return left ? down(left - 1) + "" : new Error("x").stack; }
    function top() { return names(down(depth), depth + 2); }
    return { down, top };
  }
  const f1 = makeFamily(2), f2 = makeFamily(1);
  rename(f1.down, "renamed");
  console.log("calls itself |", f1.top(), "|", f2.top());
}
{
  function makeFamily() {
    function check(value) { if (value < 0) throw new Error("x"); return value; }
    function sum(list) {
      let total = 0;
      for (const value of list) total += check(value);
      return total;
    }
    const shown = list => { try { return sum(list); } catch (error) { return names(error.stack, 2); } };
    return { check, shown };
  }
  const families = [makeFamily(), makeFamily(), makeFamily()];
  rename(families[1].check, "renamed");
  console.log("a throw off the way |", families.map(family => family.shown([1, 2, 3]) + " " + family.shown([1, -1])).join(" | "));
}
