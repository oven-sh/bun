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
type Pair = { x: any; y: any };
function read(pair: Pair) {
  const held = new Map([[1, (pair as any)[0]]]).get(1);
  return (() => (seen = again = unknown ? held : 0))();
}
say("read", () => read({ x: undefined, y: undefined }));
function empty(pair: Pair) {
  delete (pair as any)[unknownKey];
  return Object.keys(pair).length;
}
say("empty", () => empty({ x: undefined, y: undefined }));
