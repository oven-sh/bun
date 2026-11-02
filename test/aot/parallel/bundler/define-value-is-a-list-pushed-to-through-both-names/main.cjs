// A list is pushed to through a name whose `--define` value names it and through its own name, in both orders: the build reads the pushes as they are written, and finds the file that `require` takes from each joined path.
// Flags: --define FIRST=first --define LAST=last
const first = [];
FIRST.push("lib");
first.push("a.js");
const last = [];
last.push("lib");
LAST.push("b.js");
console.log(require("./" + first.join("/")).name, require("./" + last.join("/")).name);
