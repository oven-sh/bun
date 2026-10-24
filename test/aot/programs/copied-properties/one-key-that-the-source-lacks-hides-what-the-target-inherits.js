// The names come from somewhere else, and the source lacks some: undefined is stored, and it hides what the target inherits.
const lines = [];
const above = {
  run() {
    return "inherited run";
  },
  stop() {
    return "inherited stop";
  },
};
const source = {
  run() {
    return "the source's run";
  },
};
const target = Object.create(above);
for (const key of Object.keys(above)) target[key] = source[key];
lines.push(target.run());
try {
  lines.push(target.stop());
} catch (error) {
  lines.push(error.constructor.name);
}
lines.push("stop" in target, Object.hasOwn(target, "stop"), target.stop === undefined, above.stop());
console.log(lines.join("\n"));
