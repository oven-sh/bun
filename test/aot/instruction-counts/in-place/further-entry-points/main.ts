// An ordinary executable with a further entry point is asked
import fs from "node:fs";
import path from "node:path";

const here = __dirname;
const given = path.join(here, ["given", "cjs"].join("."));
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
  "require() of the loaded entry point by a computed path": repeated(() => require(given).one),
  "require.resolve() of the entry point by a computed path": repeated(() => require.resolve(given).length),
  "fs.existsSync() of a file of the disk": repeated(() => +fs.existsSync(onTheDisk)),
  "fs.existsSync() of a file that is nowhere": repeated(() => +fs.existsSync(nowhere)),
  "fs.statSync() of a file of the disk": repeated(() => fs.statSync(onTheDisk).size),
  "fs.lstatSync() of a file of the disk": repeated(() => fs.lstatSync(onTheDisk).size),
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
