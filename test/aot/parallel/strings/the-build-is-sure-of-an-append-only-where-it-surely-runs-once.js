// A pattern is joined from a list to which the program appends. The build used to count each append in the program's text as one member, whatever it stood under: it was sure of the text, gave no
// warning, and where the append did not run, or ran later, it had compiled a pattern that the run does not make. Now: in a function that is given to forEach, in one that runs when a promise is
// settled, behind the place where the pattern is made, between the join and the pattern, from a generator: nobody knows how many members are added and when, or they are added behind the
// read: no text (five calls). Under a condition that only the run knows, behind
// an early return, in a handler, in a function that is called under a condition: the list with the member is one that the program may make: it is compiled as a guess, and the call is warned of
// (four calls, of which the run here makes none). On every way through and in front of the pattern: the build is sure (two calls).
// STATISTIC: RegExpCandidatesCompiled = 6
// COUNTER: RegExpPredictedTextsCreated = 2
// COUNTER: RegExpPredictedTextsGivenCode = 2
// COUNTER: RegExpsCreatedWithoutRecord = 9
const few = process.argv.length < 99;
function fillUnlessFew(list) {
  if (few) return;
  list.push("b+");
}
function fill(list, text) {
  list.push(text);
}
function* each() {
  yield "a+";
  yield "b+";
}
const made = [];
{ const parts = ["f+"]; [1, 2].forEach(() => parts.push("b+")); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["g+"]; Promise.resolve().then(() => parts.push("b+")); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["h+"]; made.push(new RegExp(parts.join("|"))); parts.push("b+"); }
{ const parts = [...each()]; made.push(new RegExp(parts.join("-"))); }
{ const parts = ["p+"]; const text = parts.join("|"); parts.push("b+"); made.push(new RegExp(text)); }
{ const parts = ["a+"]; if (!few) parts.push("b+"); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["c+"]; fillUnlessFew(parts); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["d+"]; try { JSON.parse(few ? "1" : "{"); } catch { parts.push("b+"); } made.push(new RegExp(parts.join("|"))); }
{ const parts = ["e+"]; if (!few) fill(parts, "b+"); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["i+"]; parts.push("j+"); parts.push("k+", "l+"); made.push(new RegExp(parts.join("|"))); }
{ const parts = ["m+"]; fill(parts, "n+"); fill(parts, "o+"); made.push(new RegExp(parts.join("|"))); }
console.log(made.map(pattern => pattern.source).join(" "));
console.log(made.map(pattern => (pattern.test("a c d e f g h i m p a-b") ? 1 : 0)).join(""));
