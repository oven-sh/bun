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
class Base {
  x: any = undefined;
}
class Derived extends Base {
  y: any = undefined;
}
function read(base: Base) {
  const held = new Map([[1, base.x]]).get(1);
  return (() => (seen = again = unknown ? held : 0))();
}
say("read", () => read(unknown ? new Derived() : new Base()));
function empty(base: Base) {
  delete (base as any)[unknownKey];
  return Object.keys(base).length;
}
say("empty", () => empty(unknown ? new Derived() : new Base()));
