// @ts-ignore
import { asyncRows, rows } from "./untyped-rows.js";
import { asyncExceptionRows, exceptionRows } from "./exception-rows";
import { typedAsyncRows, typedRows } from "./typed-rows";

const throws = process.argv[2] === "exceptions";
const groups: Array<[string, Record<string, () => number | Promise<number>>]> = throws
  ? [
      ["exception", exceptionRows],
      ["exception async", asyncExceptionRows],
    ]
  : [
      ["untyped", rows as Record<string, () => number>],
      ["typed", typedRows],
      ["untyped async", asyncRows as Record<string, () => Promise<number>>],
      ["typed async", typedAsyncRows],
    ];
const warmUpCalls = throws ? 20 : 300;
const tracedCalls = throws ? 1 : 4;
const names: string[] = [];
let sum = 0;
for (const [group, members] of groups) {
  for (const name of Object.keys(members)) {
    const row = members[name];
    names.push(group + ": " + name);
    if (group.endsWith("async")) {
      for (let i = 0; i < warmUpCalls; i++) sum += await row();
      process.kill(process.pid, 0);
      for (let i = 0; i < tracedCalls; i++) sum += await row();
      process.kill(process.pid, 0);
    } else {
      for (let i = 0; i < warmUpCalls; i++) sum += row() as number;
      process.kill(process.pid, 0);
      for (let i = 0; i < tracedCalls; i++) sum += row() as number;
      process.kill(process.pid, 0);
    }
  }
}
console.log(JSON.stringify({ names, sum }));
