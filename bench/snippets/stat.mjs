import { readdirSync, statSync } from "fs";
import { bench, run } from "./runner.mjs";
import { argv } from "process";

const dir = argv.length > 2 ? argv[2] : "/tmp";

const result = statSync(dir);

bench("Stat.isBlockDevice", () => result.isBlockDevice());
bench("Stat.isCharacterDevice", () => result.isCharacterDevice());
bench("Stat.isDirectory", () => result.isDirectory());
bench("Stat.isFIFO", () => result.isFIFO());
bench("Stat.isFile", () => result.isFile());
bench("Stat.isSocket", () => result.isSocket());
bench("Stat.isSymbolicLink", () => result.isSymbolicLink());

await run();
