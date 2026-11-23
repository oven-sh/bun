// What a load that the build does not see runs while a file waits for its imports, or while the head of its body runs, calls helpers that are not there yet.
import "./kept/tools.mjs";
import "./kept/consumer.mjs";
import "./jobs/helpers.mjs";
import "./jobs/consumer.mjs";
import "./head/setup.mjs";
import "./head/helpers.mjs";
import { use as useOfHead } from "./head/consumer.mjs";
import { use as useOfPeer } from "./peer/consumer.mjs";
import "./peer/third.mjs";
await globalThis.late;
useOfHead();
useOfPeer();
console.log("main");
