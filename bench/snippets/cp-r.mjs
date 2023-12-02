import { cp } from "fs/promises";

await cp(process.argv[2], process.argv[3], { recursive: true });
