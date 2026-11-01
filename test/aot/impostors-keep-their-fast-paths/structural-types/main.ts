import { cases as callables } from "./callables";
import { cases as lists } from "./lists";
import { cases as members } from "./members";
import { cases as outside } from "./outside";
import { cases as shapes } from "./shapes";
import { cases as unions } from "./unions";

const cases: Record<string, () => () => number> = {
  ...shapes,
  ...members,
  ...lists,
  ...callables,
  ...unions,
  ...outside,
};
const [name = "names", ...windows] = process.argv.slice(2);

if (name === "names") {
  console.log(Object.keys(cases).join("\n"));
} else {
  const turn = cases[name]();
  let result = 0;
  for (const window of windows) {
    const rounds = Number(window);
    for (let round = 0; round < rounds; round++) result = turn();
    process.kill(process.pid, 0);
  }
  console.log(name + ":", result);
}
