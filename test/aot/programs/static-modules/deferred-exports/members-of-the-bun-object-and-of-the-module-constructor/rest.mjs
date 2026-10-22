import { file, nanoseconds, env, argv } from "bun";
import { createRequire, isBuiltin } from "node:module";
import * as all from "node:process";
export const describe = () =>
  [typeof file, typeof nanoseconds(), env === process.env, Array.isArray(argv), typeof createRequire, isBuiltin("fs"), all.stdout === process.stdout, typeof all.cwd()].join();
