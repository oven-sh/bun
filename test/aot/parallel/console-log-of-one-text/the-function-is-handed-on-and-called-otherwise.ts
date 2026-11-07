// console.log read into a variable, called by call and apply, bound, and replaced by the program: none of these is the call that has a door of its own, and each prints what plain Bun prints.
const log = console.log;
log("through a variable");
log.call(null, "by call");
console.log.apply(console, ["by apply"]);
const bound = console.log.bind(console, "bound:");
bound("with one more");
const lines: string[] = [];
const kept = console.log;
console.log = (text: string) => {
  lines.push("caught " + text);
};
console.log("for the program's own function");
console.log(["a", "b"].join(""));
console.log = kept;
console.log(lines.join("|"));
console.log(["back", "again"].join(" "));
