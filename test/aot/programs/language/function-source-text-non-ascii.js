// The source text of a function that contains characters outside ASCII evaluates to a function with the same result. Plain Bun may escape such characters in the text, so the results are compared and the text is not printed.
function latin1String() { return "é"; }
function wideString() { return "é→😀"; }
function template() { return `é→😀${1 + 1}`; }
function café() { return "identifier"; }
function regExp() { return /→+/u.exec("a→→b")[0]; }
function comment() { /* é→😀 */ return "comment"; }
const arrow = () => "ü→";
function ascii() { return "ascii"; }

for (const f of [latin1String, wideString, template, café, regExp, comment, arrow, ascii]) {
  const evaluated = (0, eval)("(" + f + ")");
  console.log(f.name + ":", f(), evaluated() === f());
}
