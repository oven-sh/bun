// Two packages marked --external ask for what leads from their module objects to others: while they load, and after collections.
// What such a package sees as its parent stands in for the file of the program that required it. It is in no cache, and once nothing held it: module.parent was undefined from the first collection on.
// Flags: --external outside-package --external second-package
const outside = require("outside-package");
const second = require("second-package");
function show(label) {
  console.log(label, "| parent:", outside.parent(), second.parent(), "| its filename ends as mine:", outside.parentFilename().endsWith("main.cjs"), "| children:", outside.children(), "| paths:", outside.paths(), "| cached:", outside.cached());
}
console.log("while they load:", outside.atLoad, second.atLoad);
show("before a collection");
Bun.gc(true);
show("after a collection");
const garbage = [];
for (let i = 0; i < 200000; i++) garbage.push({ i });
garbage.length = 0;
Bun.gc(true);
Bun.gc(true);
show("after three");
console.log("one object every time:", outside.sameParentAsAtLoad());
