const show = require("./show.cjs");
require("./reads-before-it-stores.cjs");
require("./stores-before-it-reads.cjs");
require("./stores-in-other-ways.cjs");
require("./stores-a-module-and-then-a-number.cjs");

const child = require("./is-stored-into-by-its-parent.cjs");
const objectOfChild = module.children.find(each => each.filename.endsWith("is-stored-into-by-its-parent.cjs"));
show("before its parent stores", objectOfChild);
objectOfChild.parent = "text";
show("after its parent stored", objectOfChild);
child.showAgain();

require("./is-required-twice.cjs");
require("./requires-it-again.cjs");

show("the entry file", module);
module.parent = 7;
show("the entry file after a number", module);
module.parent = objectOfChild;
show("the entry file after a module", module);
module.parent = undefined;
show("the entry file after undefined", module);
