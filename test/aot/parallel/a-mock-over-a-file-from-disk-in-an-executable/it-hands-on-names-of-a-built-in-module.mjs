// The program writes a file and loads it. The file hands on two names of node:path. A mock over the file ends, and node:path has its own functions again.
// Flags: --aot-allow-code-from-disk
import { mock, vi } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
const file = join(mkdtempSync(join(tmpdir(), "mock-over-a-file-from-disk-")), "bar" + "rel.mjs");
await Bun.write(file, 'export { basename, extname } from "node:path";\n');
const barrel = await import(file);
const read = () => [barrel.basename("/a/b.txt"), basename("/a/b.txt"), extname("/a/b.txt")].join();
console.log("loaded", read());
mock.module(file, () => ({ basename: () => "mock", extname: () => "mock" }));
console.log("mocked", read());
const actual = await vi.importActual(file);
console.log("actual", actual.basename("/a/b.txt"), actual.extname("/a/b.txt"));
vi.doUnmock(file);
console.log("ended", read());
