// `object["fir" + rest]` finds what lies under a name that begins so: a name that the program writes, one that it builds, one that came with data, and an index.
const lines = [];
function say(label, value) { lines.push(label + ": " + value); }
function attempt(read) { try { return read(); } catch (error) { return error.constructor.name; } }
const parts = JSON.parse('{"st":"st","stly":"stly","X":"X","Y":"Y","A":"A","empty":"","two":"2","zero":"0","cond":"cond","ly":"ly","Above":"Above","One":"One","Two":"Two","gth":"gth"}');

const table = { first: "first value", second: "second value", firstly: "firstly value" };
say("written", [table["fir" + parts.st], table["fir" + parts.stly], table["fir" + parts.X], table["se" + parts.cond], table["first" + parts.empty], table["first" + parts.ly]].join(" | "));

const built = { first: 1 };
built["fir" + parts.X] = "built under firX";
built[parts.st + parts.X] = "built under stX";
Object.defineProperty(built, "fir" + parts.Y, { value: "defined under firY", enumerable: false });
say("built", [built["fir" + parts.X], built["fir" + parts.Y], built["st" + parts.X], built["fir" + parts.st], built["fir" + parts.A], Object.keys(built)].join(" | "));

const data = JSON.parse('{"firA":"firA of the data","first":"first of the data"}');
say("data", [data["fir" + parts.A], data["fir" + parts.st], data["fir" + parts.X]].join(" | "));
const spread = { ...data, first: "first of the copy" };
say("spread", [spread["fir" + parts.A], spread["fir" + parts.st]].join(" | "));
const assigned = Object.assign({ first: "first of the target", firstly: "kept" }, data);
say("assigned", [assigned["fir" + parts.A], assigned["fir" + parts.st], assigned["fir" + parts.stly]].join(" | "));
const entries = Object.fromEntries([["fir" + parts.A, "from an entry"], ["second", 2]]);
say("entries", [entries["fir" + parts.A], entries["fir" + parts.st], entries["se" + parts.cond]].join(" | "));

const numbered = { first: 1 };
numbered[12] = "twelve";
numbered[10] = "ten";
numbered["1X"] = "one X";
say("indexes", [numbered["1" + parts.two], numbered["1" + parts.zero], numbered["1" + parts.X], numbered["1" + parts.A], numbered["1" + parts.empty]].join(" | "));
const list = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"];
say("array", [list["1" + parts.two], list["1" + parts.zero], list["1" + parts.empty], list["len" + parts.gth], list["1" + parts.X]].join(" | "));
say("string", ["abcdefghijklm"["1" + parts.two], "abc"["len" + parts.gth]].join(" | "));

let ran = 0;
const accessors = { get firstly() { ran++; return "getter of firstly"; }, first: "plain first", set firstX(value) { ran += 10; } };
say("accessors", [accessors["first" + parts.ly], accessors["first" + parts.empty], accessors["first" + parts.X], ran].join(" | "));

const below = Object.create({ firstAbove: "above", first: "hidden" });
below.first = "own";
say("above", [below["first" + parts.Above], below["first" + parts.empty], below["first" + parts.X]].join(" | "));

const functions = { tag: "t", firstOne() { return "one of " + this.tag; }, firstTwo() { return "two of " + this.tag; }, secondOne() { return "second of " + this.tag; } };
say("calls", [functions["first" + parts.One](), functions["first" + parts.Two](), functions["second" + parts.One](), attempt(() => functions["first" + parts.X]())].join(" | "));
functions["first" + parts.X] = function () { return "added of " + this.tag; };
say("calls, added", functions["first" + parts.X]());

class Kind { firstField = "field"; firstMethod() { return "method"; } static firstStatic = "static"; }
const word = JSON.parse('{"Field":"Field","Method":"Method","Static":"Static"}');
say("class", [new Kind()["first" + word.Field], new Kind()["first" + word.Method](), Kind["first" + word.Static], new Kind()["first" + word.Static]].join(" | "));

let sum = 0;
const hot = { firstOne: 1, firstTwo: 2, secondOne: 100 };
const names = [parts.One, parts.Two, parts.X];
for (let i = 0; i < 30000; i++) sum += hot["first" + names[i % 3]] ?? 1000;
say("hot", sum);
console.log(lines.join("\n"));
