function say(name: string, f: () => unknown) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, String(error));
  }
}
const unknownKey: string = JSON.parse('"x"');
const unknown: number = JSON.parse("1");
let seen: unknown, again: unknown;
const makers: (() => { x: any })[] = [
  () => ({ x: undefined as any, a: 1 }),
  () => ({ x: undefined as any, b: 1 }),
  () => ({ x: undefined as any, c: 1 }),
  () => ({ x: undefined as any, d: 1 }),
  () => ({ x: undefined as any, e: 1 }),
  () => ({ x: undefined as any, f: 1 }),
  () => ({ x: undefined as any, g: 1 }),
  () => ({ x: undefined as any, h: 1 }),
  () => ({ x: undefined as any, i: 1 }),
  () => ({ x: undefined as any, j: 1 }),
  () => ({ x: undefined as any, k: 1 }),
  () => ({ x: undefined as any, l: 1 }),
];
function read(some: { x: any }) {
  const held = new Map([[1, some.x]]).get(1);
  return (() => (seen = again = unknown ? held : 0))();
}
say("read", () => read(makers[unknown]()));
function empty(some: { x: any }) {
  delete (some as any).x;
  return Object.keys(some).length;
}
say("empty", () => empty(makers[unknown + 1]()));
function emptyUnderAnyName(some: { x: any }) {
  delete (some as any)[unknownKey];
  return Object.keys(some).length;
}
say("empty under any name", () => emptyUnderAnyName(makers[unknown + 2]()));
