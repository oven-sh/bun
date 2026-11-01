// Flags: --aot-check=verify-each-pass
import * as named from "./named.ts";
function inDefault(x: number, l = named.f(1)): number {
  return l + x;
}
async function inImport(x: number, on?: boolean): Promise<number> {
  if (on) {
    const { f } = await import("./imported.ts");
    return f(x);
  }
  return x;
}
function inRequire(x: number, on?: boolean): number {
  if (on) return (require("./required.ts") as typeof import("./required.ts")).f(x);
  return x;
}
console.log(inDefault(5, 2), await inImport(5), inRequire(5));
