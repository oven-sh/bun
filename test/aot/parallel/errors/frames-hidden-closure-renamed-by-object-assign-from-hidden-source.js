// A closure that the compiler cannot follow is renamed. Its frames show the new name, and its sibling's frames do not.
const names = stack =>
  stack
    .split("\n")
    .slice(1, 3)
    .map(line =>
      line
        .trim()
        .replace(/ ?\(.*\)$/, "")
        .replace(/^at /, "")
        .replace(/^.*\.[mc]?[jt]s:.*$/, "module"),
    )
    .join(" < ");
function passThrough(value) {
  return [value].flatMap(element => [element])[0];
}
let last = "";
const make = () =>
  function plain() {
    last = new Error("x").stack;
    return 0;
  };
function show(title, renamed, sibling) {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += renamed();
  const first = names(last);
  for (let i = 0; i < 3; i++) sum += sibling();
  console.log(title, "|", first, "|", names(last), "|", renamed.displayName, sum);
}
const renamed = passThrough(make()),
  sibling = passThrough(make());
show("before", renamed, sibling);
Object.assign(renamed, passThrough({ displayName: "given" }));
show("after", renamed, sibling);
