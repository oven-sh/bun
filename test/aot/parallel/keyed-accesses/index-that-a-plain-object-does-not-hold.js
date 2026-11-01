// A plain object is asked for an index that it does not hold. The answer is undefined only where nothing above the object answers for an index.
const lines = [];
function read(object, index) { return object[index]; }
const readers = [read];
function ask(title, object, indices) {
  lines.push(`${title}: ${indices.map(index => String(readers[0](object, index))).join(" ")}`);
}
const indices = [0, 1, 2, 5, 7, 100, 4294967294, 4294967295, -1, 1.5, "3", "03"];
function memo() { const made = {}; made[1] = "one"; made[5] = "five"; return made; }
const plain = memo(), empty = {}, bare = Object.create(null), bareWithOne = Object.create(null);
bareWithOne[2] = "two";
const numbers = {}; numbers[0] = 1; numbers[2] = 3;
const fractions = {}; fractions[0] = 0.5; fractions[3] = 1.5;
const sparse = {}; sparse[1] = "near"; sparse[4000000] = "far";
const withGetter = {}; Object.defineProperty(withGetter, 7, { get() { return "from a getter"; } });
const frozen = Object.freeze(memo());
const below = Object.create({ 2: "from the parent", 100: "far in the parent" }); below[1] = "own";
const belowPlain = Object.create(memo());
const later = memo();
const all = { plain, empty, bare, bareWithOne, numbers, fractions, sparse, withGetter, frozen, below, belowPlain, later };
function askAll(when) { for (const name in all) ask(`${when} ${name}`, all[name], indices); }
for (let again = 0; again < 3; again++) askAll(`round ${again}`);
Object.setPrototypeOf(later, { 7: "from a parent given later" });
askAll("after a parent was given");
delete plain[5];
plain[2] = "two";
askAll("after a delete and a store");
Object.setPrototypeOf(empty, new Proxy({}, { get(target, key) { return `trap ${String(key)}`; } }));
Object.setPrototypeOf(numbers, [10, 11, 12, 13, 14, 15]);
Object.setPrototypeOf(fractions, null);
askAll("after three more parents");
console.log(lines.join("\n"));
