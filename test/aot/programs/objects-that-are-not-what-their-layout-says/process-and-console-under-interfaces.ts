// Interfaces that `process` and `console` satisfy
interface HasArgv {
  argv: string[];
}
interface HasLog {
  log(...a: unknown[]): void;
}
function argv(p: HasArgv): string {
  return (
    typeof p.argv + "|" + Array.isArray(p.argv) + "|" + (p instanceof Object) + "|" + Object.prototype.toString.call(p)
  );
}
function log(c: HasLog): string {
  return typeof c.log + "|" + Object.prototype.toString.call(c);
}
const a: HasArgv[] = [{ argv: [] }, process];
const b: HasLog[] = [{ log() {} }, console];
for (let round = 0; round < 3; round++) {
  for (const v of a) console.log(argv(v));
  for (const v of b) console.log(log(v));
}
