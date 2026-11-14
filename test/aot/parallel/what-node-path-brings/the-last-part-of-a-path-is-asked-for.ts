// STATISTIC: ImageFunctionsEmitted <= 30
import path, { basename, join } from "node:path";
const written: string = JSON.parse('"/somewhere/else/a file.txt"');
console.log(basename(written), path.extname(written), join("a", "..", "b"), path.posix.sep, path.win32.basename("c:\\x\\y"));
