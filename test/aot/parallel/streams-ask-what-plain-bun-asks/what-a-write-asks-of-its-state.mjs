import { Transform, Writable } from "node:stream";
const lines = [];
const later = () => new Promise(resolve => setImmediate(resolve));
const make = (options = {}) =>
  new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
    ...options,
  });
for (const lay of [
  { value: "hex", configurable: true },
  { get: () => "hex", configurable: true },
]) {
  const stream = make({
    defaultEncoding: "latin1",
    write(chunk, encoding, callback) {
      lines.push("default encoding " + chunk.toString("hex") + " " + encoding);
      callback();
    },
  });
  Object.defineProperty(stream._writableState, "defaultEncoding", lay);
  stream.write("4142");
}
{
  const stream = new Transform({
    defaultEncoding: "latin1",
    transform(chunk, encoding, done) {
      lines.push("transform " + chunk.length);
      done();
    },
  });
  Object.defineProperty(stream._writableState, "defaultEncoding", { value: "hex" });
  stream.end("6162");
  await later();
}
{
  const said = [];
  const stream = make();
  Object.defineProperty(stream._writableState, "writecb", {
    get: () => undefined,
    set: value => said.push("set " + typeof value),
    configurable: true,
  });
  stream.write("a", () => said.push("callback"));
  await later();
  lines.push("writecb " + said.join());
}
for (const lay of [
  { value: "mine", configurable: true, writable: true },
  { get: () => "mine", set() {}, configurable: true },
]) {
  const heard = [];
  const stream = make();
  stream.on("error", () => {});
  stream.cork();
  stream.write("a", error => heard.push(error === "mine" ? "mine" : error.code));
  stream.write("b", error => heard.push(error === "mine" ? "mine" : error.code));
  Object.defineProperty(stream._writableState, "errored", lay);
  stream.destroy();
  await later();
  await later();
  lines.push("errored " + String(stream.errored) + " " + heard.join());
}
{
  const said = [];
  const real = process.nextTick;
  const stream = make();
  stream.on("error", error => said.push("error " + error.name));
  process.nextTick = (callback, ...given) => callback(...given);
  for (const name of ["a", "b", "c"]) {
    try {
      said.push(name + " returned " + stream.write(name, () => said.push(name + " called back")));
    } catch (error) {
      said.push(name + " threw " + error.name);
    }
  }
  process.nextTick = real;
  lines.push("ticks at once: " + said.join());
}
{
  const stream = make();
  const ended = new Promise(resolve =>
    stream.on("error", error => resolve(error.code + " " + /\b_write\b/.test(error.stack))),
  );
  stream.end();
  stream.write("a");
  lines.push("behind the end " + (await ended));
  const objects = make({ objectMode: true });
  const destroyed = new Promise(
    resolve =>
      objects.write({}, () => {}) &&
      objects.destroy() &&
      objects.write({}, error => resolve(error.code + " " + /\b_write\b/.test(error.stack))),
  );
  lines.push("behind destroy " + (await destroyed));
}
{
  const stream = make({ highWaterMark: 1, write() {} });
  const state = stream._writableState;
  let length = state.length,
    reads = 0;
  Object.defineProperty(state, "length", {
    configurable: true,
    get() {
      reads++;
      return length;
    },
    set(value) {
      length = value;
    },
  });
  lines.push("length " + stream.write("abc") + " " + reads);
}
console.log(lines.join("\n"));
process.exit(0);
