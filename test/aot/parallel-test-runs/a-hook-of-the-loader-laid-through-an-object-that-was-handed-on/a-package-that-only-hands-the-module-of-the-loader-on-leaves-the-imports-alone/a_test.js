import { test } from "bun:test";
import { names, near } from "./reads-names.cjs";
import { five } from "./five.js";
import { four } from "./four.js";
import { one } from "./one.js";
import { six } from "./six.js";
import { three } from "./three.js";
import { two } from "./two.js";
test("the imports answer as ever", () => {
  console.log("SAID", names(), near(), one(), two(), three(), four(), five(), six());
});
