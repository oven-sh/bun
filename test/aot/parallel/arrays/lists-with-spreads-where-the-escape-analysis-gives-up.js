// Flags: --aot-limit=MaxEscapeAnalysisWork:0
// Where the escape analysis gives up, nothing is known of any list: none is shared between calls, laid in the frame or taken apart.
function texts(name, verbose, file) {
  return ["run", ...(verbose ? ["--verbose"] : []), name, ...(file ? ["--file", file] : [])];
}
console.log(
  JSON.stringify([texts("n", true, "f"), texts("n", false, undefined), texts("n", true, ""), texts("n", false, "g")]),
);

function numbers(more) {
  const list = [1, 2, 3];
  if (more) list.push(4);
  return list;
}
console.log(JSON.stringify([numbers(true), numbers(false), numbers(true)]));

function kept() {
  const inner = ["a"];
  const outer = [inner, ["b"]];
  inner.push("c");
  return outer;
}
const first = kept();
first[1].push("d");
console.log(JSON.stringify([first, kept()]), first[0] === kept()[0]);

function handedOn(...rest) {
  return rest;
}
function spread(list) {
  const made = handedOn(0, ...list);
  made.push("end");
  return made;
}
console.log(JSON.stringify([spread([1, 2]), spread([]), spread([3])]));

function record(on) {
  const made = { list: ["x"], on };
  if (on) made.list.push("y");
  return made;
}
console.log(JSON.stringify([record(true), record(false), record(true)]));
