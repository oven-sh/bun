import main, { named } from "./barrel.js";
import * as byName from "./barrel.js";
import * as byStar from "./star.js";

export const read = () => [main(), named()].join();
export const readOffObject = () =>
  [byName.default(), byName.named(), typeof byStar.default, "default" in byStar, byStar.fn(), Object.keys(byStar).join("+")].join();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = main() + "," + named() + "," + byName.default();
  return seen;
}
