// An old object is looked at again by a young collection only if the store said so, or if what was stored is held elsewhere.
// A string of the text that a function makes again and again is held by the program. One that the body of a module makes once is held by nothing but the object.
const once = { text: undefined, other: undefined };
const many = [];
for (let i = 0; i < 2000; i++) many.push({ text: undefined, kind: undefined, index: i });
class Failure {
  constructor(index) {
    this.index = index;
    this.code = undefined;
  }
}
const failures = [];
for (let i = 0; i < 2000; i++) failures.push(new Failure(i));
Bun.gc(true);
Bun.gc(true);

function fill(holder) {
  holder.text = "a string of the text that a function stores again and again";
  holder.kind = holder.index & 1 ? "odd" : "";
}
function fail(failure) {
  failure.code = "A_CODE_AS_ERRORS_HAVE_THEM";
}
function churn() {
  let kept = 0;
  for (let round = 0; round < 40; round++) {
    const garbage = [];
    for (let i = 0; i < 20000; i++) garbage.push("garbage " + i + " of round " + round);
    kept += garbage[round].length;
    Bun.gc(false);
  }
  return kept > 0;
}

once.text = "a string of the text that the body of the module stores once";
once.other = "x";
for (const holder of many) fill(holder);
for (const failure of failures) fail(failure);
console.log(churn());
Bun.gc(true);
console.log(churn());

console.log(once.text, once.other);
console.log(many.every(holder => holder.text === "a string of the text that a function stores " + ["again", "and", "again"].join(" ")));
console.log(many.filter(holder => holder.kind === "odd").length, many.filter(holder => holder.kind === "").length);
console.log(failures.every(failure => failure.code.length === 26 && failure.code.startsWith("A_CODE")));
