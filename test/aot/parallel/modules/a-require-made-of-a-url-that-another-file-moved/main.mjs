// A require() made of import.meta.url looks beside the URL that a file stored there that import.meta was handed to.
import { createRequire } from "node:module";
import { move } from "./helper.mjs";
move(import.meta);
try {
  console.log(createRequire(import.meta.url)("./berth.cjs").deck);
} catch (error) {
  console.log(error.code);
}
