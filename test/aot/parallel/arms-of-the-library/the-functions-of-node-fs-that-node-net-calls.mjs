import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
for (const name of ["appendFileSync", "chmodSync", "closeSync", "fstatSync", "statSync"]) {
  const it = fs[name];
  console.log(
    name,
    it.name,
    it.length,
    "prototype" in it,
    Object.getOwnPropertyNames(it).join(),
    it.toString(),
    Object.getPrototypeOf(it) === Function.prototype,
  );
}
const folder = fs.mkdtempSync(join(tmpdir(), "the-five-"));
const file = join(folder, "text.txt");
const { appendFileSync, chmodSync, closeSync, fstatSync, statSync } = fs;
appendFileSync(file, "one ");
appendFileSync(file, "two", { mode: 0o600 });
chmodSync(file, 0o640);
console.log(
  fs.readFileSync(file, "utf8"),
  (statSync(file).mode & 0o777).toString(8),
  typeof statSync(file, { bigint: true }).size,
);
const fd = fs.openSync(file, "r");
console.log(fstatSync(fd).size, typeof fstatSync(fd, { bigint: true }).size, closeSync(fd));
for (const call of [
  () => fstatSync(fd),
  () => statSync(join(folder, "none")),
  () => closeSync("no"),
  () => new statSync(file),
]) {
  try {
    call();
  } catch (error) {
    console.log(error.constructor.name, error.code);
  }
}
console.log(statSync(join(folder, "none"), { throwIfNoEntry: false }));
fs.rmSync(folder, { recursive: true });
