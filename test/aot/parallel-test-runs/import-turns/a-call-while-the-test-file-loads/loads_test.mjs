// The test file waits for the call at its top, so its load has not settled when the text comes: nothing puts the text off.
import { test } from "bun:test";

globalThis.jobs = 0;
let row = Promise.resolve();
for (let i = 0; i < 100; i++) row = row.then(() => void globalThis.jobs++);
const { value } = await import("./file.mjs");
console.log("the test file goes on behind", globalThis.jobs, "jobs");

test("the test file has what it awaited", () => console.log("imported", value));
