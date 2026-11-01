// list.indexOf(text, from) and list.includes(text, from): every kind of array, of text and of start.
const rope = JSON.parse('"ab"') + JSON.parse('"cd"');
const match = /^(?:\/a\/([^/]+)()|\/b\/([^/]+)\/([^/]+)())$/.exec("/b/x/y");
const holey = ["a", , "b", , ""]; const sparse = []; sparse[1000] = "far";
const frozen = Object.freeze(["x", "", "y"]); const withNames = Object.assign(["p", "q"], { extra: "q" });
class Below extends Array {} const below = Below.from(["m", "", "n"]);
const inherited = ["a", , "c"]; const other = Object.create(Array.prototype); other[1] = "from above"; Object.setPrototypeOf(inherited, other);
const lists = [[], [""], ["a", "b", "abcd", "", "b"], [1, 2, 3], [1.5, "1.5", NaN], [undefined, null, "", "undefined", "null"], match, holey, sparse, frozen, withNames, below, inherited, [new String("b"), "b"], [Symbol.iterator, 10n, {}, "b"], Array(5), new Array(3).fill("z"), "text".split(""), [rope, "abcd"], Array.from({ length: 40 }, (_, i) => "k" + i)];
const texts = ["", "a", "b", "abcd", rope, "1.5", "undefined", "null", "z", "k39", "from above", "far", "q", "é", "\u{1F600}"];
const starts = [undefined, 0, 1, 2, 4, 5, 100, -1, -2, -100, 1.5, NaN, Infinity, -Infinity, "1", null, true, { valueOf() { return 1; } }];
function index(list, text, from) { const at = list.indexOf(text, from); return at + 0; }
function indexAlone(list, text) { const at = list.indexOf(text); return at + 0; }
function has(list, text, from) { const found = list.includes(text, from); return found === true; }
function hasAlone(list, text) { const found = list.includes(text); return found === true; }
function router(found) { const at = found.indexOf("", 1); return at + 0; }
function inTail(found) { return found.indexOf("", 1); }
let lines = [];
for (let round = 0; round < 6; round++) {
  lines = lists.map((list, n) => n + ": " + texts.map(text => starts.map(from => index(list, text, from) + (has(list, text, from) ? "+" : "-")).join("") + "/" + indexAlone(list, text) + (hasAlone(list, text) ? "+" : "-")).join(" "));
}
console.log(lines.join("\n"));
console.log(router(match), router(["", ""]), router([""]), router([]), inTail(match), inTail(["", ""]));
const others = [5, null, undefined, {}, NaN, true, Symbol.iterator, 10n];
console.log(lists.map(list => others.map(value => index(list, value, 0) + (has(list, value, 0) ? "+" : "-")).join("")).join(" "));
const shrinking = ["a", "b", "c", "d"]; console.log(index(shrinking, "d", { valueOf() { shrinking.length = 2; return 0; } }), shrinking.length);
const like = { length: 3, 0: "x", 1: "", 2: "x" }; console.log(Array.prototype.indexOf.call(like, "", 1), Array.prototype.includes.call(like, "x", 1), Array.prototype.indexOf.call("text", "x", 1));
for (const bad of [null, undefined]) { try { Array.prototype.indexOf.call(bad, "", 1); } catch (error) { console.log(error.name); } }
