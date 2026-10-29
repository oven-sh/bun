// The host makes the namespace object of one of its modules by reading every export, which names none. The read that names an export through the namespace object does.

import * as path from "node:path";
import * as util from "node:util";
import * as moduleOfNode from "node:module";
import * as os from "node:os";

console.log(path.join("a", "b"), util.format("%s-%d", "x", 1), moduleOfNode.isBuiltin("node:os"), typeof os.cpus().length);
const hand = namespace => namespace;
console.log(hand(util).inspect({ a: [1, 2] }), hand(path).posix.basename("/a/b.js"));
