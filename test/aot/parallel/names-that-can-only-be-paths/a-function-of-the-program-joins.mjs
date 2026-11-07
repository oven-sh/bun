// `path` and `__dirname` are names of the program here.
// Env: NAME=util
import { format } from "node:util";
const name = process.env.NAME;
const path = { join: (...parts) => parts[parts.length - 1], resolve: part => part };
console.log(format("%s", 1), require(path.join(import.meta.dir, name)).stripVTControlCharacters("b"));
console.log(require(path.resolve(name)).stripVTControlCharacters("c"));
{
  const __dirname = "";
  console.log(require(__dirname + name).stripVTControlCharacters("d"));
}
