// reduceRight() walks a list of numbers and an undefined, then findIndex() looks for the undefined. The list has storage that holds any value.
// Behind a test for storage of doubles no element is undefined and findIndex() only counts to the end. A list in other storage must not come into that code behind the first walk.
let out = "";
function note(value) {
  out += String(value) + ";";
}
function nothing() {}
function walk(list) {
  note(list.reduceRight((all, each, at) => all + "|" + at + ":" + each, ""));
  note(list.findIndex((each, at) => each === undefined));
}
walk([-1, 7, [][0]]);
walk(Array.from({ length: 3 }, (each, at) => (at === 1 ? nothing() : 1)));
console.log(out);
