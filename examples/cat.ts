import { resolve } from "path";
const { write, stdout, file } = Bun;
const { argv } = process;

const path = resolve(argv.at(-1));
await write(stdout, file(path));
