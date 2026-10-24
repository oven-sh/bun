// Classes below built-in classes declare fields under the names that the parent's constructor, its prototype object or the engine defines on or above an instance.
const lines: string[] = [];
function attempt(read: () => unknown): string {
  try {
    const value = read();
    return typeof value + " " + (typeof value === "object" || typeof value === "function" ? "" : String(value));
  } catch (e) {
    return "throws " + (e as Error).name;
  }
}
class Failure extends Error {
  message: string = "mine";
  cause: number = 3;
  name: string = "Failure";
  stack: string = "no stack";
}
class Quiet extends Error {
  declare message: string;
  declare cause: number;
  code = 1;
}
class Sized extends Map<string, number> {
  // @ts-expect-error
  size: number = 40;
  // @ts-expect-error
  get: number = 41;
}
class Counted extends Set<string> {
  // @ts-expect-error
  has: string = "own";
}
class Pattern extends RegExp {
  lastIndex: number = 2;
  // @ts-expect-error
  source: string = "mine";
}
class Moment extends Date {
  // @ts-expect-error
  getTime: number = 7;
}
class Bytes extends Uint8Array {
  // @ts-expect-error
  length: number = 99;
  // @ts-expect-error
  byteLength: string = "own";
}
class Text extends String {
  extra: number = 5;
}
function failure(k: Failure): string {
  return [attempt(() => k.message), attempt(() => k.cause), attempt(() => k.name), attempt(() => k.stack), attempt(() => String(k)), attempt(() => Object.keys(k).join())].join(" | ");
}
function quiet(k: Quiet): string {
  return [attempt(() => k.message), attempt(() => k.cause), attempt(() => k.code), attempt(() => "cause" in k), attempt(() => Object.hasOwn(k, "message")), attempt(() => Object.keys(k).join())].join(" | ");
}
function sized(k: Sized): string {
  return [attempt(() => k.size), attempt(() => k.get), attempt(() => k.has("a")), attempt(() => Map.prototype.get.call(k, "a")), attempt(() => [...k.keys()].join()), attempt(() => Object.keys(k).join())].join(" | ");
}
function counted(k: Counted): string {
  return [attempt(() => k.has), attempt(() => k.size), attempt(() => Set.prototype.has.call(k, "a")), attempt(() => Object.keys(k).join())].join(" | ");
}
function pattern(k: Pattern): string {
  return [attempt(() => k.lastIndex), attempt(() => k.source), attempt(() => k.flags), attempt(() => k.test("aaaa")), attempt(() => k.lastIndex), attempt(() => Object.keys(k).join())].join(" | ");
}
function moment(k: Moment): string {
  return [attempt(() => k.getTime), attempt(() => k.valueOf()), attempt(() => k.toISOString()), attempt(() => Object.keys(k).join())].join(" | ");
}
function bytes(k: Bytes): string {
  return [attempt(() => k.length), attempt(() => k.byteLength), attempt(() => k[1]), attempt(() => k.join()), attempt(() => Object.keys(k).join())].join(" | ");
}
function text(k: Text): string {
  return [attempt(() => k.length), attempt(() => k.extra), attempt(() => k[1]), attempt(() => k + "!"), attempt(() => Object.keys(k).join())].join(" | ");
}
for (let round = 0; round < 3; round++) {
  lines.push(failure(new Failure("given", { cause: "given" })));
  lines.push(quiet(new Quiet("given")), quiet(new Quiet("given", { cause: 9 })), quiet(new Quiet()));
  lines.push(attempt(() => sized(new Sized([["a", 1]]))));
  lines.push(attempt(() => counted(new Counted(["a"]))));
  lines.push(attempt(() => pattern(new Pattern("a", "g"))));
  lines.push(attempt(() => moment(new Moment(86400000))));
  lines.push(attempt(() => bytes(new Bytes([1, 2, 3]))));
  lines.push(attempt(() => text(new Text("text"))));
  Bun.gc(true);
}
const kept = new Failure("kept");
(Error as any).captureStackTrace(kept);
lines.push(attempt(() => typeof kept.stack), failure(Object.assign(kept, { stack: "again" })));
console.log(lines.join("\n"));
