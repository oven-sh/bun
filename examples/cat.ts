import { resolve } from "path";
const { write, stdout, file } = Bun;
import { argv } from "process";

const path = resolve(argv.at(-1)!);
await write(stdout, file(path));

Bun.stdout;
process.stdout;
