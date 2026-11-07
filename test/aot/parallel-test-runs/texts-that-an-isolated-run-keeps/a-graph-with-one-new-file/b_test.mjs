import { test, describe } from "bun:test";
const came = [];
const note = name => () => came.push(name);
const jobs = async () => { for (let job = 0; job < 40; job++) await Promise.resolve(); };
const all = [
  import("./wide.mjs").then(note("wide")),
  import("./helper.mjs").then(note("module"), note("module failed")),
  import("./helper.cjs").then(note("file"), note("file failed")),
];
await jobs();
console.log("b: behind forty jobs:", came.join() || "nothing");
await Promise.all(all);
console.log("b: when all have come:", [...came].sort().join() || "nothing");
test("end", () => {});
