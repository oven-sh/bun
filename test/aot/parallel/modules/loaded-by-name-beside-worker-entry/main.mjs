// The file of a Worker is a second entry point of the build, as Bun's documentation says. What the program loads as a module under a name that the build follows stands in
// the program that loads it: a driver whose name a call spells, and a plugin whose path stands in a file of data. Each became a program of its own, which no require() reaches.
// Entry points: ./worker.js
import manager from "manager";
console.log(manager.connect());
console.log(require(require("./config.json").plugin).which);
const worker = new Worker(new URL("./worker.js", import.meta.url));
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
