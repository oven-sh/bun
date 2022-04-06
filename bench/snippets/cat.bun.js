import { resolve } from "path";
const { write, stdout, file } = Bun;
const input = resolve(process.argv[process.argv.length - 1]);

await write(stdout, file(input));
