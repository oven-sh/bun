// Through `any` each coroutine gets what its parameters are not written to take: in front of the first suspension, behind it, under a handler, stored into a typed field, handed on to typed code.
// None of the first five holds a loop. The last two do.
function openTheWorld(): unknown { return eval("1"); }
type Point = { x: number; y: number };
class Box { value: number = 0; label: string = ""; }
function double(n: number): number { return n * 2; }

async function sum(a: number, b: number): Promise<unknown> {
  const early = a + b;
  await null;
  return [early, a + b, double(a)];
}
async function read(point: Point, name: string): Promise<unknown> {
  const early = point.x;
  await null;
  try {
    await null;
    return name.length + ":" + early + ":" + point.y;
  } catch (error) {
    return "caught " + (error as Error).constructor.name;
  }
}
async function store(box: Box, value: number, label: string): Promise<unknown> {
  await null;
  box.value = value;
  box.label = label;
  return typeof box.value + " " + typeof box.label + " " + box.value + box.label;
}
function* steps(from: number, text: string): Generator<unknown> {
  yield from + 1;
  yield text.length;
  yield double(from);
}
async function* pairs(point: Point): AsyncGenerator<unknown> {
  yield point.x;
  await null;
  yield point.y;
}
async function total(list: number[], start: number): Promise<unknown> {
  await null;
  let all = start;
  for (let i = 0; i < list.length; i++) all += list[i];
  return all;
}
function* countdown(from: number): Generator<unknown> {
  for (let i = from; i > 0; i--) yield i;
}

const show = (value: unknown) => console.log(JSON.stringify(value) ?? String(value));
async function attempt(run: () => unknown): Promise<void> {
  try {
    show(await run());
  } catch (error) {
    show("thrown " + (error as Error).constructor.name);
  }
}
async function drain(iterable: AsyncGenerator<unknown>): Promise<unknown[]> {
  const seen: unknown[] = [];
  for await (const value of iterable) seen.push(value);
  return seen;
}

async function main() {
  openTheWorld();
  const any = (value: unknown): any => value;
  const getter = { get x() { return "got x"; }, get y() { return "got y"; } };
  for (let turn = 0; turn < 3; turn++) {
    await attempt(() => sum(1, 2));
    await attempt(() => read({ x: 1, y: 2 }, "name"));
    await attempt(() => store(new Box(), 3, "three"));
    await attempt(() => [...steps(1, "ab")]);
    await attempt(() => drain(pairs({ x: 1, y: 2 })));
    await attempt(() => total([1, 2, 3], 0));
    await attempt(() => [...countdown(3)]);
  }
  await attempt(() => sum(any("1"), 2));
  await attempt(() => sum(1.5, any(undefined)));
  await attempt(() => sum(any(1n), any(2n)));
  await attempt(() => sum(any({ valueOf() { return 7; } }), any(null)));
  await attempt(() => sum(any(Symbol.iterator), 1));
  await attempt(() => read(any(getter), "name"));
  await attempt(() => read(any({ y: 2 }), any(["a", "b"])));
  await attempt(() => read(any(null), "name"));
  await attempt(() => read({ x: 1, y: 2 }, any(undefined)));
  await attempt(() => read(any("text"), any({ length: -1 })));
  await attempt(() => store(new Box(), any("three"), any(3)));
  await attempt(() => store(any({}), 1, "one"));
  await attempt(() => store(any(Object.freeze(new Box())), 1, "one"));
  await attempt(() => store(any(undefined), 1, "one"));
  await attempt(() => [...steps(any("1"), any(5))]);
  await attempt(() => [...steps(any(undefined), any(null))]);
  await attempt(() => drain(pairs(any(getter))));
  await attempt(() => drain(pairs(any(undefined))));
  await attempt(() => total(any("123"), any("")));
  await attempt(() => total(any({ length: 2, 0: "a", 1: 1 }), 0.5));
  await attempt(() => total(any(null), 0));
  await attempt(() => [...countdown(any("2"))]);
  await attempt(() => [...countdown(any(2.5))]);
  await attempt(() => sum(1, 2));
  await attempt(() => read({ x: 1, y: 2 }, "name"));
  console.log("end");
}
main();
