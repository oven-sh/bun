// An interface that extends a built-in class requires the names that native code stores, such as `errors` and `size`.
// The program stores neither of the two.
// IR-UNTIL CheckTypesAtEntry
// Only the literal with a name and a message has what an Error has.
// IR= 1 describeWarning parameters=\[\{type=undefined\|null\|L[0-9]+\|Error [a-z]
// IR= 0 describeFailures parameters=\[\{type=[^ ]*\bL[0-9]
// IR= 0 describeUpload parameters=\[\{type=[^ ]*\bL[0-9]
interface Warning extends Error {
  note?: string;
}
interface Failures extends AggregateError {
  note?: string;
}
interface Upload extends Blob {
  note?: string;
}

function describeWarning(warning: Warning): void {
  console.log(warning.name, warning.note);
}
function describeFailures(failures: Failures): void {
  console.log(failures.name, failures.note);
}
function describeUpload(upload: Upload): void {
  console.log(upload.size, upload.note);
}

function makeNamed(id: number) {
  return { id, name: "row" };
}
function makeNamedWithMessage(id: number) {
  return { id, name: "row", message: "text" };
}
function makeTyped(id: number) {
  return { id, type: "row" };
}

let sum = 0;
for (let i = 0; i < 1000; i++) sum += makeNamed(i).id + makeNamedWithMessage(i).id + makeTyped(i).id;
console.log(sum);

// Whoever reads them off the global object may call them with anything.
const anybody = globalThis as any;
Object.assign(anybody, { describeWarning, describeFailures, describeUpload });
anybody.describeWarning(new Error("one"));
anybody.describeFailures(new AggregateError([1], "several"));
anybody.describeUpload(new Blob(["text"]));
