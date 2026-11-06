// While require() loads an ES module, a CommonJS file of the graph calls import() of that module, and files that run after it throw. `bun run` loses their errors too.
globalThis.say = (...words) => console.log(...words);
globalThis.text = error => error.message.split(" in module")[0];
try {
  require("./module.mjs");
  say("later: required");
} catch (error) {
  say("later: threw", text(error));
}
