// The runtime's own modules put elements and properties straight into lists and objects that they have made themselves: the callbacks that a plugin of a build registers under one namespace, the queue of a stream when it grows around its end, the cells of the rows that a query inserts, and the Node stream that is laid over a file's stream. The program drives each of the four and prints what comes out.
// Flags: --aot-verify-each-pass
import { SQL } from "bun";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const entry = join(tmpdir(), `entry-of-two-kinds-${process.pid}.js`);
await Bun.write(entry, 'import a from "./x.first-kind"; import b from "./x.second-kind"; console.log(a + b);');
const built = await Bun.build({
  entrypoints: [entry],
  plugins: [
    {
      name: "two callbacks under one namespace",
      setup(build) {
        build.onResolve({ filter: /-kind$/ }, found => ({ path: found.path, namespace: "kinds" }));
        build.onLoad({ filter: /first-kind$/, namespace: "kinds" }, () => ({
          contents: "export default 40",
          loader: "js",
        }));
        build.onLoad({ filter: /second-kind$/, namespace: "kinds" }, () => ({
          contents: "export default 2",
          loader: "js",
        }));
        for (const wrong of [
          5,
          {},
          { filter: "text" },
          { filter: /x/, namespace: 5 },
          { filter: /x/, namespace: "a b" },
        ] as any[]) {
          try {
            build.onLoad(wrong, () => undefined);
            console.log("taken");
          } catch (error: any) {
            console.log(error.name, error.message);
          }
        }
        try {
          build.onLoad({ filter: /x/ }, 5 as any);
        } catch (error: any) {
          console.log(error.name, error.message);
        }
      },
    },
  ],
});
unlinkSync(entry);
const bundled = await built.outputs[0].text();
console.log(built.success, built.outputs.length, bundled.includes("40"), bundled.includes("first-kind"));

let controllerOfQueue!: ReadableStreamDefaultController<number>;
const queued = new ReadableStream<number>({
  start(controller) {
    controllerOfQueue = controller;
  },
});
const reader = queued.getReader();
let sum = 0;
let next = 0;
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 3 + round * 5; i++) controllerOfQueue.enqueue(next++);
  for (let i = 0; i < 2 + round; i++) sum += (await reader.read()).value!;
}
controllerOfQueue.close();
let left = 0;
for (let step = await reader.read(); !step.done; step = await reader.read()) {
  sum += step.value;
  left++;
}
console.log(next, left, sum);

const sql = new SQL("sqlite://:memory:");
await sql`CREATE TABLE points (name TEXT, x INTEGER, y REAL)`;
const rows = [
  { name: "a", x: 1, y: 0.5 },
  { name: "b", x: 2, y: undefined },
  { name: "c", x: 3, y: 2.5 },
];
await sql`INSERT INTO points ${sql(rows)}`;
await sql`INSERT INTO points ${sql(rows, "name", "x")}`;
console.log(JSON.stringify(await sql`SELECT * FROM points ORDER BY name, y`));
for (const wrong of [[null], [{}]] as any[]) {
  try {
    await sql`INSERT INTO points ${sql(wrong)}`;
    console.log("inserted");
  } catch (error: any) {
    console.log(error.name, error.message);
  }
}
await sql.close();

const path = join(tmpdir(), `lines-for-a-stream-${process.pid}.txt`);
await Bun.write(path, "a line of text\n".repeat(5000));
const overFile = Readable.fromWeb(Bun.file(path).stream() as any);
let bytes = 0;
let first = "";
for await (const chunk of overFile) {
  if (!bytes) first = chunk.subarray(0, 14).toString();
  bytes += chunk.length;
}
unlinkSync(path);
console.log(first, bytes, overFile.destroyed);
