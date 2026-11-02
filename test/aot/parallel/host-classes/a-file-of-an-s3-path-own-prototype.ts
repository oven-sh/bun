// Bun.file() makes a Blob of a path and an S3File of an "s3://" path. The prototype object of an S3File lies in front of Blob.prototype and has every member of that one once more.
import { tmpdir } from "node:os";
import { join } from "node:path";

const path = join(tmpdir(), `a-file-of-an-s3-path-${process.pid}.txt`);
await Bun.write(path, "hello");

function describe(file: Blob) {
  const prototype = Object.getPrototypeOf(file);
  return [
    Object.prototype.toString.call(file),
    file instanceof Blob,
    prototype === Blob.prototype,
    Object.getPrototypeOf(prototype) === Blob.prototype,
    Object.hasOwn(prototype, "text"),
    file.text === Blob.prototype.text,
    typeof (file as any).presign,
    (file as any).bucket,
    Reflect.ownKeys(file).length,
  ].join(" ");
}

const local = Bun.file(path);
const remote = Bun.file("s3://bucket/key.txt");
console.log(describe(local));
console.log(describe(remote));
console.log(describe(local.slice(1, 3)));
console.log(describe(remote.slice(1, 3)));
for (const file of [local, remote] as any[]) console.log(file.name === path, typeof file.stat, file.stat === (Blob.prototype as any).stat);

console.log(await local.text(), local.size, await local.exists(), (await local.bytes()).length, await local.slice(1, 3).text());
console.log(typeof (remote as any).presign({ accessKeyId: "a", secretAccessKey: "b", endpoint: "http://localhost:1" }));
try {
  (remote as any).presign.call(local);
} catch (error) {
  console.log((error as NodeJS.ErrnoException).code);
}
try {
  Reflect.get(Object.getPrototypeOf(remote), "bucket", local);
} catch (error) {
  console.log((error as Error).name);
}
await local.delete();
