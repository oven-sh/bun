// `JSON.parse(text) as T` where T reaches more and more object types, around the numbers at which the compiler stops listing them. Past such a number the program is slower. It prints the same.
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { generated } from "./generated/run-generated";
import { tsconfig } from "./generated/typed-object-mutations";
import { built, inShare, slot, spawned, unsupported } from "./run-programs";

const many = (count: number, each: (at: number) => string, between = "\n") =>
  Array.from({ length: count }, (_, at) => each(at)).join(between);

const order = (members: number) => `
interface Order {
  lines: { count: number }[];
${many(members, at => `  p${at}?: { a${at}: number };`)}
}
`;

// A reviver hands the same object back twice, so what comes out of the parse is an object of the program: one object under two indexes, and a store through either is seen through the other.
const textOf = (members: number, withReviver: boolean) => `${order(members)}
const shared = { count: 5 };
const order = JSON.parse('{"lines":[{"count":1},{"count":2}],"p0":{"a0":3}}'${withReviver ? `, (key, value) => (key === "0" || key === "1" ? shared : value)` : ""}) as Order;
console.log(order.lines[0] === order.lines[1], order.lines[0] === shared, order.p0?.a0);
shared.count = 6;
console.log(order.lines[0].count, order.lines[1].count);
order.lines[1].count = 7;
console.log(shared.count, order.lines[0].count);
`;

generated(
  "a parse by a type that reaches very many objects",
  [
    1, 15, 16, 17, 63, 64, 65, 127, 128, 129, 251, 252, 253, 254, 255, 256, 257, 258, 511, 512, 513, 1023, 1024, 1025,
  ].flatMap(members =>
    [true, false].map(withReviver => ({
      name: `${members} object types, ${withReviver ? "with" : "without"} a reviver.`,
      isAlwaysRun: members >= 251 && members <= 258,
      isOnlyCompiled: true as const,
      make: () => ({ file: "main.ts", text: textOf(members, withReviver), files: { "tsconfig.json": tsconfig } }),
    })),
  ),
);

const show = `
function show(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + Array.from(value, show).join() + "]";
  return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key])).join() + "}";
}
function attempt(what: string, run: () => unknown): void {
  try {
    console.log(what, show(run()));
  } catch (error) {
    console.log(what, (error as Error).constructor.name, (error as Error).message);
  }
}
`;
const good = `'{"lines":[{"count":1},{"count":2}],"p0":{"a0":3},"p1":{"a1":4}}'`;
const use = `
function use(order: Order): void {
  console.log(order.lines[0].count + order.lines[1].count, order.p0?.a0, order.p1?.a1, order.p2?.a2, Object.keys(order).join());
  order.lines[1].count = 7;
  order.p0!.a0 += 1;
  order.p2 = { a2: 9 };
  (order as any).later = "added";
  delete order.p1;
  console.log(JSON.stringify(order));
}
`;

// What a program prints does not depend on the count: the judge is the same program with a type of eight.
const kinds: Record<string, (count: number) => string> = {
  "a parse, and texts that are no such object": count => `${show}${order(count)}${use}
use(JSON.parse(${good}) as Order);
attempt("a text for a number", () => JSON.parse('{"lines":[{"count":"1"}]}') as Order);
attempt("a text for a number further in", () => JSON.parse('{"lines":[],"p1":{"a1":"x"}}') as Order);
attempt("lines are missing", () => JSON.parse('{"p0":{"a0":1}}') as Order);
attempt("an array for the object", () => JSON.parse('[]') as Order);
attempt("no JSON", () => JSON.parse('{"lines":') as Order);
attempt("more members", () => JSON.parse('{"other":[1,{"x":2}],"lines":[]}') as Order);
attempt("a reviver that answers a text", () => JSON.parse(${good}, (key, value) => (key === "a0" ? "x" : value)) as Order);
`,
  "a parse in a loop": count => `${order(count)}
let sum = 0;
for (let at = 0; at < 2000; at++) {
  const order = JSON.parse('{"lines":[{"count":' + at + '}],"p0":{"a0":1},"p1":{"a1":2}}') as Order;
  sum += order.lines[0].count + order.p0!.a0 + (order.p1?.a1 ?? 0) + (order.p2?.a2 ?? 0);
}
console.log(sum);
`,
  "a parse under a cast and into an annotated variable": count => `${order(count)}${use}
use(JSON.parse(${good}) as Order);
const annotated: Order = JSON.parse(${good});
use(annotated);
`,
  "bodies of requests and responses": count => `${order(count)}${use}
use((await new Request("http://localhost/", { method: "POST", body: ${good} }).json()) as Order);
const annotated: Order = await new Response(${good}).json();
use(annotated);
use((await Response.json(JSON.parse(${good})).json()) as Order);
`,
  "a chain of types": count => `${show}${many(count, at => `interface N${at} { v: number; next?: N${at + 1} }`)}
interface N${count} { v: number }
const head = JSON.parse('{"v":0,"next":{"v":1,"next":{"v":2,"next":{"v":3}}}}') as N0;
console.log(head.v + head.next!.v + head.next!.next!.v + head.next!.next!.next!.v, head.next!.next!.next!.next);
head.next!.next!.v = 40;
console.log(JSON.stringify(head));
attempt("wrong at depth 3", () => JSON.parse('{"v":0,"next":{"v":1,"next":{"v":2,"next":{"v":"3"}}}}') as N0);
`,
  "a union by a tag": count => `${show}type Shape =
${many(count, at => `  | { kind: "k${at}"; a${at}: number }`)};
const shapes = JSON.parse('[{"kind":"k0","a0":1},{"kind":"k1","a1":2},{"kind":"k0","a0":3}]') as Shape[];
let sum = 0;
for (const shape of shapes) {
  if (shape.kind === "k0") sum += shape.a0;
  else if (shape.kind === "k1") sum += shape.a1 * 10;
}
console.log(sum, JSON.stringify(shapes));
attempt("an unknown tag", () => JSON.parse('[{"kind":"nothing","a0":1}]') as Shape[]);
attempt("the member of another arm", () => JSON.parse('[{"kind":"k1","a0":1}]') as Shape[]);
`,
  "a tuple": count => `${show}type Row = [${many(count, at => `{ a${at}: number }`, ", ")}];
const text = "[" + Array.from({ length: ${count} }, (_, at) => '{"a' + at + '":' + (at < 2 ? at + 1 : 0) + "}").join() + "]";
const row = JSON.parse(text) as Row;
console.log(row.length === ${count}, row[0].a0 + row[1].a1, row[2].a2);
row[1].a1 = 5;
console.log(JSON.stringify(row.slice(0, 3)));
attempt("a text in the second", () => (JSON.parse(text.replace('"a1":2', '"a1":"2"')) as Row).slice(0, 3));
attempt("too short", () => (JSON.parse('[{"a0":1}]') as Row as unknown[]).length);
`,
  "a type that reaches itself": count => `${show}interface Tree {
  kids: Tree[];
${many(count, at => `  p${at}?: { a${at}: number; up?: Tree };`)}
}
const tree = JSON.parse('{"kids":[{"kids":[],"p0":{"a0":1,"up":{"kids":[]}}}],"p1":{"a1":2}}') as Tree;
console.log(tree.kids[0].p0!.a0 + tree.p1!.a1, tree.kids[0].p0!.up!.kids.length);
tree.kids[0].p0!.up!.kids.push(tree.kids[0]);
console.log(tree.kids[0].p0!.up!.kids[0] === tree.kids[0]);
attempt("wrong far in", () => JSON.parse('{"kids":[{"kids":[],"p0":{"a0":1,"up":{"kids":[1]}}}]}') as Tree);
`,
  "values under any name": count => `${show}${order(count)}
type Book = { [name: string]: Order };
const book = JSON.parse('{"first":{"lines":[{"count":1}],"p0":{"a0":2}},"second":{"lines":[]}}') as Book;
console.log(Object.keys(book).join(), book.first.lines[0].count + book.first.p0!.a0, book.second.lines.length, book.third);
attempt("wrong under a name", () => JSON.parse('{"first":{"lines":[{"count":"1"}]}}') as Book);
`,
  "lists of as many types": count => `${show}interface Lists {
${many(count, at => `  p${at}?: { a${at}: number }[];`)}
}
const lists = JSON.parse('{"p0":[{"a0":1},{"a0":2}],"p1":[]}') as Lists;
console.log(lists.p0![0].a0 + lists.p0![1].a0, lists.p1!.length, lists.p2);
lists.p1!.push({ a1: 4 });
console.log(JSON.stringify(lists));
attempt("wrong in a list", () => JSON.parse('{"p1":[{"a1":null}]}') as Lists);
`,
  "as many types, each with a call of its own":
    count => `${many(count, at => `interface T${at} { a${at}: number; inner: { b${at}: number } }`)}
let sum = 0;
${many(count, at => `sum += (JSON.parse('{"a${at}":1,"inner":{"b${at}":1}}') as T${at}).inner.b${at};`)}
console.log(sum === ${count});
`,
  // The objects that the small type's parser makes are known one by one. Those of the same type that come out of the large one's are changed here in every way.
  "an object type that a small type reaches too": count => `interface Inner { x: number; y: number }
interface Small { inner: Inner }
interface Large {
  inner: Inner;
${many(count, at => `  p${at}?: { a${at}: number };`)}
}
function sumOf(inner: Inner): number { return inner.x + inner.y; }
const small = JSON.parse('{"inner":{"x":1,"y":2}}') as Small;
const large = JSON.parse('{"inner":{"x":3,"y":4},"p0":{"a0":5}}') as Large;
console.log(sumOf(small.inner), sumOf(large.inner));
(large.inner as any).x = "text";
(large.inner as any).z = 1;
delete (large.inner as any).y;
console.log(sumOf(small.inner), sumOf(large.inner), JSON.stringify(large.inner), JSON.stringify(small.inner));
let total = 0;
for (let at = 0; at < 2000; at++) total += sumOf((JSON.parse('{"inner":{"x":1,"y":2}}') as Small).inner) + sumOf((JSON.parse('{"inner":{"x":1.5,"y":2}}') as Large).inner);
console.log(total);
`,
  "a field of a class, and a generic function": count => `${order(count)}
class Holder {
  order: Order;
  constructor(text: string) { this.order = JSON.parse(text) as Order; }
  total(): number { return this.order.lines.reduce((sum, line) => sum + line.count, 0) + (this.order.p0?.a0 ?? 0); }
}
console.log(new Holder(${good}).total(), new Holder('{"lines":[]}').total());
function first<T>(list: T[]): T { return list[0]; }
const orders = JSON.parse('[' + ${good} + ']') as Order[];
console.log(first(orders).lines[1].count, first<Order>(orders).p0!.a0, orders.length);
`,
  "a parse in a worker": count => `import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
${order(count)}
function sumOf(text: string): number {
  const order = JSON.parse(text) as Order;
  return order.lines[0].count + order.lines[1].count + order.p0!.a0 + (order.p2?.a2 ?? 0);
}
if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url), { workerData: ${good} });
  const answer = await new Promise<number>(resolve => worker.once("message", resolve));
  await worker.terminate();
  console.log("the worker says", answer, "and the main thread", sumOf(${good}));
} else parentPort!.postMessage(sumOf(workerData));
`,
};

describe.concurrent("compile/aot/generated/a large type prints what a small one prints", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  const root = String(tempDir("aot-large-types", {}));
  const run = async (folder: string, text: string) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "main.ts"), text);
    writeFileSync(join(folder, "tsconfig.json"), tsconfig);
    const executable = join(folder, isWindows ? "program.exe" : "program");
    try {
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], folder, bunEnv),
      );
      const { stdout, signal, exitCode } = await spawned([executable], folder, bunEnv);
      expect(stdout).not.toBe("");
      return { stdout, signal, exitCode };
    } finally {
      rmSync(executable, { force: true });
    }
  };
  const chosen = Object.entries(kinds).flatMap(([kind, make], at) =>
    [300, 1025].map(count => ({ name: `${kind}: ${count} for 8`, make, count, folder: join(root, `${at}-${count}`) })),
  );
  for (const { name, make, count, folder } of chosen.filter(({ name, count }) =>
    inShare(name, count === 300 ? 4 : 16),
  )) {
    test(
      name,
      () =>
        slot(async () =>
          expect(await run(folder, make(count))).toEqual({
            ...(await run(join(folder, "small"), make(8))),
            signal: null,
            exitCode: 0,
          }),
        ),
      600_000,
    );
  }
});
