import { cases as functions } from "./functions.js";
import { cases as helpers } from "./helpers.js";
import { cases as lists } from "./lists.js";
import { cases as numbers } from "./numbers.js";
import { cases as objects } from "./objects.js";
import { cases as olderStyle } from "./older-style.js";
import { cases as strings } from "./strings.js";

const cases = { ...lists, ...numbers, ...strings, ...objects, ...functions, ...olderStyle, ...helpers };
const [name, ...windows] = process.argv.slice(2);

if (name === "names") {
  console.log(Object.keys(cases).join("\n"));
} else {
  const { prepare, turn } = cases[name];
  const subject = prepare();
  let result;
  for (const window of windows) {
    const rounds = Number(window);
    for (let round = 0; round < rounds; round++) result = turn(subject);
    process.kill(process.pid, 0);
  }
  console.log(name + ":", result);
}
