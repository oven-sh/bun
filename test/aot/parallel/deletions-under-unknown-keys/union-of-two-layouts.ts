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
type Either = { x: any; y: any } | { x: any; z: any };
function read(either: Either) {
  const held = new Map([[1, either.x]]).get(1);
  return (() => (seen = again = unknown ? held : 0))();
}
say("read", () => read(unknown ? { x: undefined, y: 1 } : { x: undefined, z: 2 }));
function empty(either: Either) {
  delete (either as any)[unknownKey];
  return Object.keys(either).length;
}
say("empty", () => empty(unknown ? { x: undefined, y: 1 } : { x: undefined, z: 2 }));
