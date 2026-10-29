// One name is first imported as a type, which is erased, and then declared by `import =`: the second is the binding that runs.
// @ts-nocheck
import type path = require("node:fs");
import path = require("node:path");
import type { one } from "node:fs";
namespace Numbers {
  export var first = 1;
}
import one = Numbers.first;
console.log(path.basename("/a/b.txt"), one);
