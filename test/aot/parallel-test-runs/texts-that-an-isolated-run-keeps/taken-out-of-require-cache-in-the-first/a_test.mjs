import { test, describe } from "bun:test";
const came = [];
const note = name => () => came.push(name);
const jobs = async () => { for (let job = 0; job < 40; job++) await Promise.resolve(); };
require("./helper.cjs");
delete require.cache[require.resolve("./helper.cjs")];
await jobs();
console.log("a: behind forty jobs:", came.join() || "nothing");
test("end", () => {});
