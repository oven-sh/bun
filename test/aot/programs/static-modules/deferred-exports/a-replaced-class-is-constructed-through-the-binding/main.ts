import fs from "node:fs";
class Patched {
  path: string;
  constructor(path: string) {
    this.path = "patched:" + path;
  }
}
(fs as any).WriteStream = Patched;
const rest = await import("./rest.ts");
const made = rest.make("a") as unknown as Patched;
console.log(made.path, made instanceof Patched, rest.isOne(new Patched("b")), rest.isOne({}), rest.nameOfClass());
