// JSON.parse<T> and validate<T> where T reaches more and more object types, around the numbers at which the compiler stops listing them. Past such a number the program is slower. It prints the same.
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
const textOf = (members: number, withReviver: boolean) => `import { JSON } from "bun";${order(members)}
const shared = { count: 5 };
const order = JSON.parse<Order>('{"lines":[{"count":1},{"count":2}],"p0":{"a0":3}}'${withReviver ? `, (key, value) => (key === "0" || key === "1" ? shared : value)` : ""});
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
    const issues = (error as any).issues;
    console.log(what, (error as Error).constructor.name, issues ? issues.map((issue: any) => issue.path.join(".") + " " + issue.code + " " + String(issue.expected).slice(0, 24) + " " + issue.received).join("; ") : (error as Error).message);
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

// What a program prints does not depend on the count. Plain Bun validates nothing and has no validate(), so the judge is the same program with a type of eight.
const kinds: Record<string, (count: number) => string> = {
  "a parse, and texts that it refuses": count => `import { JSON } from "bun";${show}${order(count)}${use}
use(JSON.parse<Order>(${good}));
attempt("a text for a number", () => JSON.parse<Order>('{"lines":[{"count":"1"}]}'));
attempt("a text for a number further in", () => JSON.parse<Order>('{"lines":[],"p1":{"a1":"x"}}'));
attempt("lines are missing", () => JSON.parse<Order>('{"p0":{"a0":1}}'));
attempt("an array for the object", () => JSON.parse<Order>('[]'));
attempt("no JSON", () => JSON.parse<Order>('{"lines":'));
attempt("more members", () => JSON.parse<Order>('{"other":[1,{"x":2}],"lines":[]}'));
attempt("a reviver that answers a text", () => JSON.parse<Order>(${good}, (key, value) => (key === "a0" ? "x" : value)));
`,
  "a parse in a loop": count => `import { JSON } from "bun";${order(count)}
let sum = 0;
for (let at = 0; at < 2000; at++) {
  const order = JSON.parse<Order>('{"lines":[{"count":' + at + '}],"p0":{"a0":1},"p1":{"a1":2}}');
  sum += order.lines[0].count + order.p0!.a0 + (order.p1?.a1 ?? 0) + (order.p2?.a2 ?? 0);
}
console.log(sum);
`,
  "validate, and values that it refuses": count => `import { validate } from "bun:bundle";
${show}${order(count)}${use}
const source = { lines: [{ count: 1 }, { count: 2 }], p0: { a0: 3 }, p1: { a1: 4 } };
const copy = validate<Order>(source);
console.log(copy === (source as unknown), copy.lines === (source.lines as unknown), copy.p0 === (source.p0 as unknown));
use(copy);
console.log(JSON.stringify(source));
attempt("a text for a number", () => validate<Order>({ lines: [{ count: "1" }] }));
attempt("a text for a number further in", () => validate<Order>({ lines: [], p1: { a1: "x" } }));
attempt("lines are missing", () => validate<Order>({ p0: { a0: 1 } }));
attempt("undefined", () => validate<Order>(undefined));
attempt("a getter", () => validate<Order>({ get lines() { return [{ count: 8 }]; } }));
class Lines { lines = [{ count: 4 }]; }
attempt("an instance", () => validate<Order>(new Lines()));
`,
  "validate in a loop": count => `import { validate } from "bun:bundle";
${order(count)}
let sum = 0;
for (let at = 0; at < 2000; at++) {
  const order = validate<Order>({ lines: [{ count: at }], p0: { a0: 1 }, p1: { a1: 2 } });
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
  "a chain of types": count => `import { JSON } from "bun";${show}${many(count, at => `interface N${at} { v: number; next?: N${at + 1} }`)}
interface N${count} { v: number }
const head = JSON.parse<N0>('{"v":0,"next":{"v":1,"next":{"v":2,"next":{"v":3}}}}');
console.log(head.v + head.next!.v + head.next!.next!.v + head.next!.next!.next!.v, head.next!.next!.next!.next);
head.next!.next!.v = 40;
console.log(JSON.stringify(head));
attempt("wrong at depth 3", () => JSON.parse<N0>('{"v":0,"next":{"v":1,"next":{"v":2,"next":{"v":"3"}}}}'));
`,
  "a union by a tag": count => `import { JSON } from "bun"; import { validate } from "bun:bundle";
${show}type Shape =
${many(count, at => `  | { kind: "k${at}"; a${at}: number }`)};
for (const shapes of [JSON.parse<Shape[]>('[{"kind":"k0","a0":1},{"kind":"k1","a1":2},{"kind":"k0","a0":3}]'), validate<Shape[]>([{ kind: "k0", a0: 1 }, { kind: "k1", a1: 2 }, { kind: "k0", a0: 3 }])]) {
  let sum = 0;
  for (const shape of shapes) {
    if (shape.kind === "k0") sum += shape.a0;
    else if (shape.kind === "k1") sum += shape.a1 * 10;
  }
  console.log(sum, JSON.stringify(shapes));
}
attempt("an unknown tag", () => JSON.parse<Shape[]>('[{"kind":"nothing","a0":1}]'));
attempt("the member of another arm", () => JSON.parse<Shape[]>('[{"kind":"k1","a0":1}]'));
attempt("an unknown tag in a value", () => validate<Shape[]>([{ kind: "nothing", a0: 1 }]));
`,
  "a tuple": count => `import { JSON } from "bun";${show}type Row = [${many(count, at => `{ a${at}: number }`, ", ")}];
const text = "[" + Array.from({ length: ${count} }, (_, at) => '{"a' + at + '":' + (at < 2 ? at + 1 : 0) + "}").join() + "]";
const row = JSON.parse<Row>(text);
console.log(row.length === ${count}, row[0].a0 + row[1].a1, row[2].a2);
row[1].a1 = 5;
console.log(JSON.stringify(row.slice(0, 3)));
attempt("a text in the second", () => JSON.parse<Row>(text.replace('"a1":2', '"a1":"2"')));
attempt("too short", () => (JSON.parse<Row>('[{"a0":1}]') as unknown[]).length);
`,
  "a type that reaches itself": count => `import { JSON } from "bun";${show}interface Tree {
  kids: Tree[];
${many(count, at => `  p${at}?: { a${at}: number; up?: Tree };`)}
}
const tree = JSON.parse<Tree>('{"kids":[{"kids":[],"p0":{"a0":1,"up":{"kids":[]}}}],"p1":{"a1":2}}');
console.log(tree.kids[0].p0!.a0 + tree.p1!.a1, tree.kids[0].p0!.up!.kids.length);
tree.kids[0].p0!.up!.kids.push(tree.kids[0]);
console.log(tree.kids[0].p0!.up!.kids[0] === tree.kids[0]);
attempt("wrong far in", () => JSON.parse<Tree>('{"kids":[{"kids":[],"p0":{"a0":1,"up":{"kids":[1]}}}]}'));
`,
  "values under any name": count => `import { JSON } from "bun";${show}${order(count)}
type Book = { [name: string]: Order };
const book = JSON.parse<Book>('{"first":{"lines":[{"count":1}],"p0":{"a0":2}},"second":{"lines":[]}}');
console.log(Object.keys(book).join(), book.first.lines[0].count + book.first.p0!.a0, book.second.lines.length, book.third);
attempt("wrong under a name", () => JSON.parse<Book>('{"first":{"lines":[{"count":"1"}]}}'));
`,
  "lists of as many types": count => `import { JSON } from "bun";${show}interface Lists {
${many(count, at => `  p${at}?: { a${at}: number }[];`)}
}
const lists = JSON.parse<Lists>('{"p0":[{"a0":1},{"a0":2}],"p1":[]}');
console.log(lists.p0![0].a0 + lists.p0![1].a0, lists.p1!.length, lists.p2);
lists.p1!.push({ a1: 4 });
console.log(JSON.stringify(lists));
attempt("wrong in a list", () => JSON.parse<Lists>('{"p1":[{"a1":null}]}'));
`,
  "as many types, each with a call of its own": count => `import { JSON } from "bun"; import { validate } from "bun:bundle";
${many(count, at => `interface T${at} { a${at}: number; inner: { b${at}: number } }`)}
let sum = 0;
${many(count, at => `sum += JSON.parse<T${at}>('{"a${at}":1,"inner":{"b${at}":1}}').inner.b${at} + validate<T${at}>({ a${at}: 1, inner: { b${at}: 1 } }).a${at};`)}
console.log(sum === ${2 * count});
`,
  // The objects that the small type's parser makes are known one by one. Those of the same type that come out of the large one's are changed here in every way.
  "an object type that a small type reaches too": count => `import { JSON } from "bun"; interface Inner { x: number; y: number }
interface Small { inner: Inner }
interface Large {
  inner: Inner;
${many(count, at => `  p${at}?: { a${at}: number };`)}
}
function sumOf(inner: Inner): number { return inner.x + inner.y; }
const small = JSON.parse<Small>('{"inner":{"x":1,"y":2}}');
const large = JSON.parse<Large>('{"inner":{"x":3,"y":4},"p0":{"a0":5}}');
console.log(sumOf(small.inner), sumOf(large.inner));
(large.inner as any).x = "text";
(large.inner as any).z = 1;
delete (large.inner as any).y;
console.log(sumOf(small.inner), sumOf(large.inner), JSON.stringify(large.inner), JSON.stringify(small.inner));
let total = 0;
for (let at = 0; at < 2000; at++) total += sumOf(JSON.parse<Small>('{"inner":{"x":1,"y":2}}').inner) + sumOf(JSON.parse<Large>('{"inner":{"x":1.5,"y":2}}').inner);
console.log(total);
`,
  "a field of a class, and a generic function": count => `import { JSON } from "bun";${order(count)}
class Holder {
  order: Order;
  constructor(text: string) { this.order = JSON.parse<Order>(text); }
  total(): number { return this.order.lines.reduce((sum, line) => sum + line.count, 0) + (this.order.p0?.a0 ?? 0); }
}
console.log(new Holder(${good}).total(), new Holder('{"lines":[]}').total());
function first<T>(list: T[]): T { return list[0]; }
const orders = JSON.parse<Order[]>('[' + ${good} + ']');
console.log(first(orders).lines[1].count, first<Order>(orders).p0!.a0, orders.length);
`,
  "a parse in a worker": count => `import { JSON } from "bun"; import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
${order(count)}
function sumOf(text: string): number {
  const order = JSON.parse<Order>(text);
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
