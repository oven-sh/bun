// Patterns made of texts, and collections made of constant lists: what throws must throw at the start, and each object is made once.
const log = [];
function attempt(name, make) { try { return make(); } catch (error) { log.push(name + ":" + error.constructor.name); return null; } }
const good = new RegExp("^(a|b)+$", "gi");
const called = RegExp("x+y");
const withoutFlags = new RegExp("[0-9]{2,}", undefined);
const bad = attempt("bad pattern", () => new RegExp("(unclosed", "g"));
const badFlags = attempt("bad flags", () => new RegExp("a", "zz"));
let thrownAtTheTop = "none";
try { var top = new RegExp("[z-a]"); } catch (error) { thrownAtTheTop = error.constructor.name; }
const copy = new RegExp(good, "y");
const sticky = { pattern: new RegExp("ab", "y"), uses: 0 };
const pairs = new Map([["a", 1], ["b", 2], ["a", 3]]);
const notPairs = attempt("no pairs", () => new Map([1, 2]));
let mapAtTheTop = "none";
try { var topMap = new Map(["ab", 5]); } catch (error) { mapAtTheTop = error.constructor.name; }
const short = new Map([["only key"], []]);
const words = new Set(["x", "y", "x"]);
log.push("start is over", thrownAtTheTop, mapAtTheTop);
function main() {
  good.lastIndex = 1;
  sticky.pattern.lastIndex = 0; sticky.uses += sticky.pattern.test("abab") ? 1 : 0; sticky.uses += sticky.pattern.test("abab") ? 1 : 0;
  console.log(JSON.stringify([log, good.source, good.flags, good.lastIndex, good === good, called.test("xxy"), withoutFlags.flags, bad, badFlags, copy.flags, copy.source, sticky.uses, sticky.pattern.lastIndex,
    [...pairs], notPairs, [...short], [...words], typeof top, typeof topMap]));
}
main();
