// Every member of what Bun.file() answers, on a file that is there and on one that is not.
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = join(tmpdir(), `every-member-of-a-file-${process.pid}`);
const path = join(folder, "a.json");
await Bun.write(path, '{"a":[1,2]}');
const file = Bun.file(path);
const missing = Bun.file(join(folder, "none", "b.txt"));
const codeOf = (error: any) => `${error?.name} ${error?.code}`;

console.log(file.size, file.type, file.name === path, typeof file.lastModified, missing.size, missing.type, typeof missing.lastModified);
console.log(JSON.stringify(await file.json()), (await file.json()).a[1]);
console.log((await file.arrayBuffer()).byteLength, (await file.bytes())[0], await file.text());
console.log((await file.stat()).size, await missing.stat().catch(codeOf));
let length = 0;
for await (const chunk of file.stream()) length += chunk.length;
console.log(length);
try {
  for await (const chunk of missing.stream()) length += chunk.length;
} catch (error) {
  console.log(codeOf(error));
}
console.log(await file.slice(1, 4).text(), file.slice(1, 4).size, file.slice(0, 2, "text/plain").type);
const writer = Bun.file(join(folder, "c.txt")).writer();
writer.write("ab");
writer.write("cd");
console.log(await writer.end(), await Bun.file(join(folder, "c.txt")).text());
console.log(await Bun.file(join(folder, "d.txt")).write("xyz"), await Bun.file(join(folder, "d.txt")).text());
console.log(await missing.write("x", { createPath: false } as any).catch(codeOf));
console.log(await new Response(file).text(), new Response(file).headers.get("content-type"));
console.log(await Bun.file(join(folder, "bad.json")).json().catch(codeOf));
await Bun.write(join(folder, "bad.json"), "{");
console.log(await Bun.file(join(folder, "bad.json")).json().catch(codeOf));
console.log(await file.formData().catch(codeOf));
console.log(await file.exists(), await missing.exists());
console.log(await Bun.file(join(folder, "d.txt")).unlink(), await Bun.file(join(folder, "d.txt")).exists(), await missing.unlink().catch(codeOf));
console.log(Object.prototype.toString.call(file), file instanceof Blob, String(file), Object.keys(file).length);
for (const name of ["a.json", "bad.json", "c.txt"]) await Bun.file(join(folder, name)).delete();
