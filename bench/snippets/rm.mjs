import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "../runner.mjs";

const dir = fs.mkdtempSync(join(tmpdir(), "rm-bench-"));
const file = join(dir, "file");
const missing = join(dir, "missing");
const folder = join(dir, "folder");
fs.mkdirSync(folder);
fs.writeFileSync(join(folder, "child"), "");
const create = () => fs.closeSync(fs.openSync(file, "w"));

// The cost of the file itself, and of a removal that is not rm.
bench("create", () => create());
bench("create, unlinkSync(file)", () => {
  create();
  fs.unlinkSync(file);
});

bench("create, rmSync(file)", () => {
  create();
  fs.rmSync(file);
});
bench("rmSync(missing, { force: true })", () => fs.rmSync(missing, { force: true }));
bench("rmSync(folder), refused", () => {
  try {
    fs.rmSync(folder);
  } catch {}
});

bench("create, rm(file, callback)", () => {
  create();
  return new Promise(resolve => fs.rm(file, resolve));
});
bench("rm(missing, { force: true }, callback)", () => new Promise(resolve => fs.rm(missing, { force: true }, resolve)));
bench("rm(folder, callback), refused", () => new Promise(resolve => fs.rm(folder, resolve)));

bench("create, promises.rm(file)", () => {
  create();
  return fs.promises.rm(file);
});
bench("promises.rm(missing, { force: true })", () => fs.promises.rm(missing, { force: true }));
bench("promises.rm(folder), refused", () => fs.promises.rm(folder).catch(() => {}));

await run();
fs.rmSync(dir, { recursive: true, force: true });
