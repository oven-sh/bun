import { spyOn } from "bun:test";
import { holders } from "../../holders.js";
export function failing(name, says) {
  return spyOn(holders.math, name).mockReturnValue(says);
}
