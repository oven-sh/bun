// Property reads across shapes in a loop
import {
  emptyLoop,
  heirs,
  heirsOfEveryShape,
  passWithoutReads,
  plain,
  plainOfEveryShape,
  readAbsent,
  readAbsentOfAll,
  readFiveNames,
  readFortyAbsent,
  readFortyPresent,
  readInherited,
  readInheritedOfAll,
  readPresent,
  readPresentOfAll,
  wide,
} from "./plain.js";

type Case = (n: number) => unknown;
const cases: Record<string, () => Case> = {
  "0 empty loop": () => {
    const objects = plain(1);
    return n => emptyLoop(objects, n);
  },
};
const add = (name: string, make: () => unknown[], read: (list: unknown[], n: number) => unknown) => {
  cases[name] = () => {
    const list = make();
    return n => read(list, n);
  };
};
for (const shapes of [1, 2, 4, 8]) {
  add(`1 present, ${shapes} shapes`, () => plain(shapes), readPresent);
  add(`2 absent, ${shapes} shapes`, () => plain(shapes), readAbsent);
  add(`3 inherited, ${shapes} shapes`, () => heirs(shapes), readInherited);
}
add("4 present, 8 shapes made 1000 shapes apart", () => plain(8, 1000), readPresent);
add("4 absent, 8 shapes made 1000 shapes apart", () => plain(8, 1000), readAbsent);
add("4 inherited, 8 shapes made 1000 shapes apart", () => heirs(8, 1000), readInherited);
add("5 five names of each of six shapes", () => heirs(6), readFiveNames);
for (const shapes of [1, 2, 4]) {
  add(`6 forty present names, ${shapes} shapes`, () => wide(shapes), readFortyPresent);
  add(`6 forty absent names, ${shapes} shapes`, () => plain(shapes), readFortyAbsent);
}
add("7 the next 16 of 1024 shapes without a read", () => plainOfEveryShape(1024), passWithoutReads);
add("7 present, the next 16 of 1024 shapes", () => plainOfEveryShape(1024), readPresentOfAll);
add("7 absent, the next 16 of 1024 shapes", () => plainOfEveryShape(1024), readAbsentOfAll);
add("7 inherited, the next 16 of 1024 shapes", () => heirsOfEveryShape(1024), readInheritedOfAll);
const name = process.argv[2];
if (name === "names") console.log(Object.keys(cases).join("\n"));
else {
  const run = cases[name]();
  let last: unknown;
  for (const turns of process.argv.slice(3)) {
    last = run(Number(turns));
    process.kill(process.pid, 0);
  }
  console.log(last);
}
