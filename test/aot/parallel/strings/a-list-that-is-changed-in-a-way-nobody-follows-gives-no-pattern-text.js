// A pattern is joined from a list that the program has written out and then changed: by a method that moves, drops or overwrites members, by its length, by delete, by Object.assign, in a
// function it is handed to, or that it has filled from a Set. The build follows stores, push and a few methods. It used to take whatever else is done to a list for nothing: it was sure of the
// text of the list as written, gave no warning, compiled a pattern that nobody makes, and the pattern that the run does make was interpreted. What an operation does to its operands is declared
// with the operation, so whatever may write a list and is not followed makes the list unknown: no text is compiled for any of these calls.
// STATISTIC: RegExpCandidatesCompiled = 0
// COUNTER: RegExpsCreatedWithoutRecord = 7
// COUNTER: RegExpPredictedTextsCreated = 0
function addInFront(list) {
  list.unshift("a+");
}
const made = [];
{ const parts = ["b+", "c+"]; parts.unshift("a+"); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["a+", "x+", "c+"]; parts.splice(1, 1, "b+"); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["c+", "b+", "a+"]; parts.reverse(); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["c+", "a+", "b+"]; parts.sort(); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["a+", "b+", "x+"]; parts.pop(); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["x+", "a+", "b+"]; parts.shift(); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["x+", "y+"]; parts.fill("a+"); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["a+", "b+", "x+"]; parts.length = 2; made.push(new RegExp(parts.join("|"))); }
{ const parts = ["a+", "b+", "x+"]; parts.copyWithin(2, 0, 1); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["a+", "x+", "b+"]; delete parts[1]; made.push(new RegExp(parts.join("|"))); }
{ const parts = ["b+"]; addInFront(parts); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["x+", "b+"]; Object.assign(parts, ["a+"]); made.push(new RegExp(parts.join("|"))); }
{ const parts = [...new Set(["a+", "b+", "a+"])]; made.push(new RegExp(parts.join("|"))); }
{ const parts = Array.from(new Set(["d+", "e+", "d+"])); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["c+", "d+"]; parts.sort((first, second) => (first < second ? 1 : -1)); made.push(new RegExp(parts.join("|"))); }
console.log(made.map(each => each.source).join(" "));
console.log(made.map(each => (each.test("a b c d") ? 1 : 0)).join(""));
