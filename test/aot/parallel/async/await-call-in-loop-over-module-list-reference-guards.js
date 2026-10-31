// Flags: --aot-check=validate-reference-guards
// A loop over a list that a variable of the module holds awaits a call in every turn: the reference to the list is alive over the call, and is saved with the frame behind it.
const classes = [class A {}, class B {}];
const lines = [];
async function serve(Response) {
  lines.push(Response.name);
  await null;
}
async function all() {
  for (const Response of classes) await serve(Response);
  console.log(lines.join("\n"));
}
all();
