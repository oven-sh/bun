// `path.resolve` answers a path from the root whatever it is given, and so does `path.join` behind `process.cwd()`: the text "util" that the program writes brings no node:util.
// STATISTIC: FunctionsLowered <= 700
import path from "node:path";
const name = process.argv[5] ?? "util";
for (const load of [
  () => require(path.resolve(name)),
  () => require(path.join(process.cwd(), name)),
  () => require(process.cwd() + "/" + name),
  () => import(path.resolve(name)),
]) {
  try {
    console.log(typeof (await load()));
  } catch (error) {
    console.log(error.code);
  }
}
