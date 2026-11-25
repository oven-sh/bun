import { mock, test } from "bun:test";
const outcomes = "FFO";
const said = [];
const behind = [];
let calls = 0;
const told = async (name, load) => {
  try {
    said.push(name + " " + (await load()));
  } catch (error) {
    said.push(name + " threw " + error.message);
  }
};
const byImport = async () => (await import("./well.mjs")).ink;
const byRequire = async () => require("./well.mjs").ink;
const byHolder = async () => (await import("./pen.mjs")).line;
mock.module("./well.mjs", async () => {
  const call = ++calls;
  await Promise.resolve();
  if (call === 1) {
    let jobs = Promise.resolve();
    for (let job = 0; job < 2; job++) jobs = jobs.then(() => {});
    behind.push(jobs.then(() => told("second", byRequire)));
  }
  if (outcomes[call - 1] === "F") throw new Error("call " + call);
  return { ink: "mock " + call };
});
test("t", async () => {
  await told("first", byHolder);
  await Promise.all(behind);
  for (let job = 0; job < 12; job++) await Promise.resolve();
  await told("third", byImport);
  console.log("SAID " + said.join("; ") + "; calls " + calls);
});
