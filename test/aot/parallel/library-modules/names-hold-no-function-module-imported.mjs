// What these names hold is no function that is written in the module: functions of native code that the module has bound, constants, classes of native code, an object. Each is there, and what the module gives its functions (their names) is there too.
import { readFileSync, writeFileSync, statSync, mkdtempSync, rmSync, existsSync, constants, F_OK, Stats, Dirent } from "node:fs";
import { EOL, devNull } from "node:os";
import { performance } from "node:perf_hooks";
import { sep, join } from "node:path";
import { tmpdir } from "node:os";
const directory = mkdtempSync(join(tmpdir(), "names-"));
const file = directory + sep + "a.txt";
writeFileSync(file, "text" + EOL);
console.log(readFileSync(file, "utf8").length - EOL.length, statSync(file).isFile(), statSync(file) instanceof Stats, existsSync(file));
rmSync(directory, { recursive: true });
console.log(existsSync(file), typeof constants.O_RDONLY, F_OK, typeof Dirent, devNull.length > 0, typeof performance.now());
console.log(readFileSync.name, existsSync.name, rmSync.name, statSync.length);
