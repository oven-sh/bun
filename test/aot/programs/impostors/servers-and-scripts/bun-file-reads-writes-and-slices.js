import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "bun-file-"));
const name = join(folder, "data.json");
console.log(await Bun.write(name, JSON.stringify({ list: [1, 2, 3], text: "héllo" })));
const file = Bun.file(name);
console.log(file.size, file.type, await file.exists(), file.name === name);
console.log(await file.json(), (await file.text()).length, (await file.arrayBuffer()).byteLength, (await file.bytes()).length);
console.log(await file.slice(2, 6).text(), file.slice(2, 6).size);

const missing = Bun.file(join(folder, "missing.txt"));
console.log(await missing.exists(), missing.size, await missing.text().catch(error => error.code));

const copy = join(folder, "copy.json");
console.log(await Bun.write(copy, file), await Bun.file(copy).text() === await file.text());
console.log(await Bun.write(join(folder, "bytes.bin"), new Uint8Array([1, 2, 3])), await Bun.write(join(folder, "from-response.txt"), new Response("from a response")));
console.log(await Bun.file(join(folder, "from-response.txt")).text());

const writer = Bun.file(join(folder, "log.txt")).writer();
writer.write("first\n");
writer.write(new TextEncoder().encode("second\n"));
await writer.flush();
writer.write("third\n");
await writer.end();
console.log(JSON.stringify(await Bun.file(join(folder, "log.txt")).text()));

let streamed = 0;
for await (const chunk of Bun.file(join(folder, "log.txt")).stream()) streamed += chunk.length;
console.log(streamed, (await Bun.file(join(folder, "log.txt")).stat()).isFile());
await Bun.file(copy).delete();
console.log(await Bun.file(copy).exists(), new Response(file).headers.get("content-type"));
rmSync(folder, { recursive: true });
