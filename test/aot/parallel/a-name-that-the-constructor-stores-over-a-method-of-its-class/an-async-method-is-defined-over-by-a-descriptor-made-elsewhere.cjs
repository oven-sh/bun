"use strict";
function describe(value) { return { value, writable: true, configurable: true, enumerable: true }; }
class Task { constructor(run) { Object.defineProperty(this, "go", describe(run)); } async go() { return 1; } }
const kept = (async () => 5)();
kept.constructor = function Other() {};
kept.then = function (resolve) { resolve("text" + (process.argv[2] ?? 50)); };
const task = new Task(() => kept);
let seen = 0;
function report() { console.log(seen + 1, typeof seen); }
async function main() { seen = await task.go(); report(); }
main();
