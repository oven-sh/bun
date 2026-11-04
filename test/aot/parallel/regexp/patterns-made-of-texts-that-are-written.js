// `new RegExp("a+")`: both texts are written, so a build can know the pattern. It is a new object each time, throws where the text is no pattern, and takes its flags as they are spelled.
const word = "[a-z]+";
const both = new RegExp("^" + word + "-" + word + "$", "i");
const list = ["one", "two", "three"];
const any = new RegExp(list.join("|"), "g");
function make() { return new RegExp("a(b)?", "g"); }
function called() { return RegExp("a(b)?", "y"); }
function about(re) { return [String(re), re.source, re.flags, re.lastIndex, re.global, re.sticky, re.ignoreCase, re.hasIndices, re.unicode, re.unicodeSets, re.dotAll, re.multiline].join(" "); }
function attempt(make) { try { return about(make()); } catch (error) { return error.name + ": " + error.message; } }
console.log(both.test("Ab-cD"), both.test("a-"), "one two four three".match(any).join());
console.log(make() === make(), called() === called(), about(make()), about(called()));
const a = make(); a.test("ab"); console.log(a.lastIndex, make().lastIndex);
console.log(new RegExp("a+").test("caab"), new RegExp("a+", "y").test("caab"), new RegExp("A+", "i").exec("caab").index, "caab".replace(new RegExp("a", "g"), "-"), "caab".split(new RegExp("a+")).join());
console.log(attempt(() => new RegExp("")), attempt(() => new RegExp("/")), attempt(() => new RegExp("\n")), attempt(() => new RegExp("a", "")), attempt(() => new RegExp("a", undefined)), attempt(() => new RegExp(undefined)), attempt(() => new RegExp()));
console.log(attempt(() => new RegExp("(")), attempt(() => new RegExp("a", "gg")), attempt(() => new RegExp("a", "x")), attempt(() => new RegExp("a", "uv")), attempt(() => new RegExp("[b-a]")), attempt(() => new RegExp("\\", "")), attempt(() => new RegExp("a{2,1}")), attempt(() => new RegExp("(?<n>a)(?<n>b)")), attempt(() => new RegExp("\\p{Nope}", "u")));
function never(flag) { return flag ? new RegExp("(") : "not made"; }
console.log(never(false), attempt(() => never(true)));
console.log(attempt(() => new RegExp("\\d+(?<unit>px|em)", "d")), attempt(() => new RegExp("[\\p{L}--[a-z]]", "v")), attempt(() => new RegExp("\\u{1F600}", "u")), attempt(() => new RegExp("é|中", "i")), attempt(() => new RegExp(404)), attempt(() => new RegExp(null)), attempt(() => new RegExp(true, "g")));
console.log(attempt(() => new RegExp(/a/g)), attempt(() => new RegExp(/a/g, "i")), attempt(() => RegExp(/a/g)), attempt(() => new RegExp(/a/g, undefined)));
{ const re = /a/g; console.log(RegExp(re) === re, new RegExp(re) === re, RegExp(re, "g") === re); }
