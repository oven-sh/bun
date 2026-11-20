import os from "node:os";
import { lookup } from "node:dns";
import * as vm from "node:vm";
export const count = 3;
export function read() {
  return [typeof vm.runInNewContext, typeof lookup, os.constants];
}
