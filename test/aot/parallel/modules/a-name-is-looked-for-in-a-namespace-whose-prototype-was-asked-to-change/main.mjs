// Flags: --aot-testing=CheckProofsAtRunTime
import * as fruits from "./fruits.mjs";
import * as tools from "./tools.cjs";

const spaces = { fruits, tools };
function attempt(what, run) {
  try {
    console.log(what + ":", run());
  } catch (error) {
    console.log(what + ":", error.name);
  }
}
spaces.fruits.setApple(7);
for (const [name, key] of [
  ["fruits", "apple"],
  ["tools", "saw"],
]) {
  const space = spaces[name];
  const before = space[key];
  attempt(name + " store to a new name", () => (space.added = "stored"));
  attempt(name + " nothing", () => [].join());
  attempt(name + " prototype", () => [Reflect.setPrototypeOf(space, {}), Reflect.setPrototypeOf(space, Object.getPrototypeOf(space))].join());
  attempt(name + " freeze", () => Object.freeze(space) === space);
  console.log(name, space[key] === before, "added" in space, "apple" in space, "toString" in space, Object.keys(space).join());
}
