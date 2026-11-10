import { spyOn } from "bun:test";
import * as target from "../target.mjs";
export function run() {
  const spy = spyOn(target, "f").mockReturnValue(7);
  const got = [target.f(), target.viaOwn(), spy.mock.calls.length];
  spy.mockRestore();
  return got.join();
}
