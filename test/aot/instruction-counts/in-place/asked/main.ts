// An executable that runs in place is asked
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dir;
const compiled = path.join(here, ["compiled", "cjs"].join("."));
const held = path.join(here, "held.txt");
const onTheDisk = path.join(here, "flags.json");
const nowhere = path.join(here, "nowhere.txt");

function repeated(call: () => number) {
  return (turns: number) => {
    let sum = 0;
    for (let i = 0; i < turns; i++) sum += call();
    return sum;
  };
}

const cases: Record<string, (turns: number) => number> = {
  "require() of a loaded module by a computed path": repeated(() => import.meta.require(compiled).one),
  "require.resolve() of a computed path": repeated(() => require.resolve(compiled).length),
  "require.resolve() of what it does not hold": repeated(() => require.resolve(onTheDisk).length),
  "fs.existsSync() of a file that it holds": repeated(() => +fs.existsSync(held)),
  "fs.existsSync() of a file of the disk": repeated(() => +fs.existsSync(onTheDisk)),
  "fs.existsSync() of a file that is nowhere": repeated(() => +fs.existsSync(nowhere)),
  "fs.statSync() of a file of the disk": repeated(() => fs.statSync(onTheDisk).size),
  "fs.readFileSync() of a file that it holds": repeated(() => fs.readFileSync(held).length),
};

const name = process.argv[2];
if (name === "names") console.log(Object.keys(cases).join("\n"));
else {
  let last: unknown;
  for (const turns of process.argv.slice(3)) {
    last = cases[name](Number(turns));
    process.kill(process.pid, 0);
  }
  console.log(last);
}
