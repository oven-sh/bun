// The first name of a `--define` value is looked for where the defined name is written. A variable that a direct eval declares in the function hides a parameter of that name.
// Flags: --define NAME=target --define ROOT=holder.value
globalThis.target = "the global";
globalThis.holder = { value: "the global" };
function read(target, text) {
  eval(text);
  return [NAME, typeof NAME, target].join(", ");
}
function readPath(holder, text) {
  eval(text);
  return [ROOT, holder.value].join(", ");
}
function call(target, text) {
  eval(text);
  return NAME();
}
console.log(read("the parameter", ""), "|", read("the parameter", "var target = 1"));
console.log(
  readPath({ value: "the parameter" }, ""),
  "|",
  readPath({ value: "the parameter" }, "var holder = { value: 'declared by the text' }"),
);
console.log(
  call(() => "the parameter", ""),
  "|",
  call(() => "the parameter", "var target = () => 'declared by the text'"),
);
