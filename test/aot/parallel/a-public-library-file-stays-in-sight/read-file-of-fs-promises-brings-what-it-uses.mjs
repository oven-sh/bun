// STATISTIC: ImageFunctionsEmitted <= 700
import { readFile } from "node:fs/promises";
console.log((await readFile("/etc/hostname", "utf8")).length > 0);
