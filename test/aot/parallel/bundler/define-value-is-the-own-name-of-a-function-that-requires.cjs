// A `--define` whose value is the own name of a function expression calls that function from inside it. The function hands its parameter to `require`, and the module that only the call through the define names is loaded too.
// Flags: --define AGAIN=again
// Alone: what it prints depends on what else the executable holds: which modules were compiled in
const load = function again(name) {
  const loaded = require(name);
  const members = typeof loaded.join + " " + typeof loaded.platform;
  return name === "node:path" ? [members, AGAIN("node:os")[0]] : [members];
};
console.log(load("node:path").join());
