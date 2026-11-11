import { w } from "./p/index.mjs";
  console.log("MAIN RUNS");
  console.log("SAID", (await import("./p/index.mjs")).z);
