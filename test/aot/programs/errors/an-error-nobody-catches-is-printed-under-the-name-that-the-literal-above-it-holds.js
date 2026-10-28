// An error that nobody catches is printed under the `name` that the object above it holds. Each object is tried in a process of its own.
const ways = {
  "a literal": () => ({ __proto__: Error.prototype, name: "Refused" }),
  "a getter": () => ({ __proto__: Error.prototype, get name() { return "Computed"; } }),
  "stored later": () => {
    const above = { __proto__: Error.prototype };
    above.name = "StoredLater";
    return above;
  },
  "a static field": () => class { static name = "StaticField"; },
  "an instance": () => new (class { name = "Field"; })(),
  "a literal without it": () => ({ __proto__: Error.prototype, other: 1 }),
};
const way = process.env.WAY_TO_HOLD_THE_NAME;
if (way) throw Object.setPrototypeOf(new Error("nobody catches this"), ways[way]());

const { spawnSync } = require("node:child_process");
const command = /[$~]bun/i.test(process.argv[1]) ? [] : [process.argv[1]];
for (const name of Object.keys(ways)) {
  const { stderr, status } = spawnSync(process.execPath, command, {
    encoding: "utf8",
    env: { ...process.env, WAY_TO_HOLD_THE_NAME: name },
  });
  console.log(name + ": " + stderr.split("\n").findLast(line => line.includes("nobody catches this")) + " " + status);
}
