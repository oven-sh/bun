import { createHash } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
const hash = createHash("sha256");
for await (const chunk of createReadStream(input!, { highWaterMark: 1 << 22 })) hash.update(chunk);
writeFileSync(output!, `${hash.digest("hex")}\n`);
