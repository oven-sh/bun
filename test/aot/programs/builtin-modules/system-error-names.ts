// util.getSystemErrorName() and the errors that are named through it: one function, whoever asks for it; its checks, its name and its length are plain Bun's.
import util from "node:util";
import { constants } from "node:os";

const known = [constants.errno.ENOENT, constants.errno.EACCES, constants.errno.ECONNREFUSED, 1, 4058, 4092];
for (const number of known) console.log(-number, util.getSystemErrorName(-number), util.getSystemErrorMessage(-number));
console.log(util.getSystemErrorName.name, util.getSystemErrorName.length, Object.keys(util).includes("getSystemErrorName"));
for (const value of [0, 1, -1.5, -(2 ** 53), NaN, -Infinity, "-2", undefined, null, {}, 2n]) {
  try {
    console.log(util.getSystemErrorName(value as any));
  } catch (error) {
    console.log((error as any).name, (error as any).code, (error as Error).message);
  }
}
const failed: any = (util as any)._errnoException(-constants.errno.ENOENT, "open", "a file");
console.log(failed.message, failed.code, failed.errno === -constants.errno.ENOENT, failed.syscall, failed.constructor === Error, failed instanceof Error);
try {
  (util as any)._errnoException("no number", "open");
} catch (error) {
  console.log((error as any).code, (error as Error).message);
}
const replaced = util.getSystemErrorName;
(util as any).getSystemErrorName = () => "REPLACED";
console.log((util as any)._errnoException(-constants.errno.EACCES, "read").code);
(util as any).getSystemErrorName = replaced;
