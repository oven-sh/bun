// An array with an accessor for an element, with an own property that hides a built-in method, or with another prototype is still an array to the functions of the runtime that take one.
import { closeSync, openSync, readFileSync, readvSync, rmSync, writevSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const file = join(tmpdir(), `arrays-handed-to-the-runtime-${process.pid}.bin`);
const first = new Uint8Array(4).fill(0x41);
const second = new Uint8Array(2).fill(0x42);
const row = (name: string, f: () => unknown) => {
  let r: unknown;
  try {
    r = f();
  } catch (e) {
    r = "THROWS " + (e as Error).message;
  }
  console.log(name + ": " + JSON.stringify(r));
};
function withAccessor<T>(head: T, tail: T): T[] {
  const array: T[] = [head];
  Object.defineProperty(array, 1, { enumerable: true, configurable: true, get: () => tail });
  return array;
}
function withOwnMethod<T>(...items: T[]): T[] {
  const array: T[] = [...items];
  Object.defineProperty(array, "push", { value: () => 0, configurable: true, writable: true });
  return array;
}
function withOtherPrototype<T>(...items: T[]): T[] {
  const array: T[] = [...items];
  Object.setPrototypeOf(array, Object.create(Array.prototype));
  return array;
}
function written(buffers: Uint8Array[]) {
  const fd = openSync(file, "w");
  try {
    return [writevSync(fd, buffers), readFileSync(file, "latin1")];
  } finally {
    closeSync(fd);
  }
}
function read(buffers: Uint8Array[]) {
  const fd = openSync(file, "r");
  try {
    return [readvSync(fd, buffers), buffers.length];
  } finally {
    closeSync(fd);
  }
}
row("writevSync, as made", () => written([first, second]));
row("writevSync, an accessor", () => written(withAccessor(first, second)));
row("writevSync, an own method", () => written(withOwnMethod(first, second)));
row("writevSync, another prototype", () => written(withOtherPrototype(first, second)));
row("readvSync, an accessor", () => read(withAccessor(new Uint8Array(4), new Uint8Array(2))));
row("readvSync, an own method", () => read(withOwnMethod(new Uint8Array(4), new Uint8Array(2))));
row("Buffer.concat, an accessor", () => Buffer.concat(withAccessor(first, second)).toString("latin1"));
row("Buffer.from, an own method", () => Buffer.from(withOwnMethod(65, 66)).toString("latin1"));
row("Buffer.from, an accessor", () => Buffer.from(withAccessor(65, 66)).toString("latin1"));
row("emitWarning, an own method", () => process.emitWarning("w", withOwnMethod("a") as any));
row("emitWarning, as made", () => process.emitWarning("w", ["a"] as any));
row("Blob, an accessor", () => new Blob(withAccessor("a", "b")).size);
row("Blob, an own method", () => new Blob(withOwnMethod("a", "b")).size);
row("tls, as made", () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, tls: { ca: ["x"] } }).stop());
row("tls, an own method", () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, tls: { ca: withOwnMethod("x") } }).stop());
row("tls, an accessor", () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, tls: { ca: withAccessor("x", "y") } }).stop());
row("spawnSync, an own method", () => Bun.spawnSync(withOwnMethod("/bin/echo", "said")).stdout.toString());
row("spawnSync, an accessor", () => Bun.spawnSync(withAccessor("/bin/echo", "said")).stdout.toString());
row("structuredClone, an own method", () => structuredClone(withOtherPrototype(1, 2)));
row("inspect", () => [Bun.inspect(withOwnMethod(1, 2)), Bun.inspect(withOtherPrototype(1, 2)), Bun.inspect(withAccessor(1, 2))]);
row("deepEquals", () => [Bun.deepEquals(withOtherPrototype(1, 2), [1, 2]), Bun.deepEquals(withAccessor(1, 2), [1, 2])]);
row("JSON", () => [withOwnMethod(1, 2), withOtherPrototype(1, 2), withAccessor(1, 2)]);
rmSync(file, { force: true });
