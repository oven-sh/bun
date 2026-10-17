// A native object that has the members a type requires is accepted as that type, including when it arrives inside a container from untyped code.
// Each function writes `{ length: number }` again, so each one is checked on its own. One object literal of the program fits them all.
const own = { length: 7 };
console.log("own", own.length);

function untyped(value: unknown): any {
  (globalThis as any).stash = value;
  return (globalThis as any).stash;
}

function ofArray(list: { length: number }[]) {
  let total = 0;
  for (const item of list) total += item.length;
  return total;
}
function ofIterable(list: Iterable<{ length: number }>) {
  let total = 0;
  for (const item of list) total += item.length;
  return total;
}
function spread(list: Iterable<{ length: number }>) {
  return [...list].map(item => item.length).join();
}
function ofIterator(steps: Iterator<{ length: number }>) {
  return steps.next().value.length;
}
function ofSet(set: Set<{ length: number }>) {
  let total = 0;
  for (const item of set) total += item.length;
  return total;
}
function ofMap(map: Map<string, { length: number }>) {
  return map.get("key")!.length;
}
function ofRecord(record: Record<string, { length: number }>) {
  return record.key.length;
}
function ofFunction(make: () => { length: number }) {
  return make().length;
}
async function ofPromise(promise: Promise<{ length: number }>) {
  return (await promise).length;
}
async function ofAsyncIterable(list: AsyncIterable<{ length: number }>) {
  let total = 0;
  for await (const item of list) total += item.length;
  return total;
}
async function* later(value: unknown) {
  yield value;
}

const values: [string, unknown][] = [
  ["a typed array", new Uint8Array(3)],
  ["a Buffer", Buffer.from("four")],
  ["an array", [1, 2]],
  ["a string", "text!"],
  ["a function", function (a: number, b: number, c: number) {}],
  ["an object of the program", own],
  ["an object of untyped code", JSON.parse('{ "length": 9 }')],
];
for (const [what, value] of values) {
  console.log(
    what + ":",
    ofArray(untyped([value])),
    ofIterable(untyped([value])),
    ofIterable(untyped(new Set([value]))),
    spread(untyped([value, value])),
    ofIterator(untyped([value].values())),
    ofSet(untyped(new Set([value]))),
    ofMap(untyped(new Map([["key", value]]))),
    ofRecord(untyped({ key: value })),
    ofFunction(untyped(() => value)),
    await ofPromise(untyped(Promise.resolve(value))),
    await ofAsyncIterable(untyped(later(value))),
  );
}

// The function itself is passed to untyped code, which calls it with its own values.
console.log("by map", (await Promise.all(untyped([later(new Uint8Array(5)), later("ab")]).map(ofAsyncIterable))).join());
console.log("a stream", await ofAsyncIterable(untyped(new Response("hello").body)));

// A stream typed by the host's own declarations.
async function ofStream(list: AsyncIterable<{ length: number }>) {
  let total = 0;
  for await (const item of list) total += item.length;
  return total;
}
console.log("a stream, as the host declares it", await ofStream(new Response("hello!").body!));
