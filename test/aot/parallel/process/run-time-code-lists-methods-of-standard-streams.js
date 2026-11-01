// The program names no standard stream, so nothing that makes one is in the executable. Names stay: code evaluated at run time finds every method of plain Bun's streams,
// on the object that holds it there, with its name, its length and whether it is listed. What plain Bun's streams lack is absent, and nothing here throws.
const join = (...parts) => parts.join(process.argv.length > 99 ? "x" : "");
const walk = `
  const rows = [];
  for (let at = stream, depth = 0; at && at !== Object.prototype; at = Object.getPrototypeOf(at), depth++) {
    const methods = [];
    for (const key of Reflect.ownKeys(at)) {
      if (typeof key !== "string") continue;
      const descriptor = Reflect.getOwnPropertyDescriptor(at, key);
      if (typeof descriptor.value !== "function") continue;
      methods.push(key + ":" + descriptor.value.name + ":" + descriptor.value.length + ":" + descriptor.enumerable + descriptor.writable + descriptor.configurable);
    }
    rows.push(depth + " " + (depth ? at.constructor.name : "own") + " " + methods.join(" "));
  }
  return rows.join("\\n");`;
const state = {
  out: "_writev flush start pos bytesWritten _construct _events _writableState _maxListeners readable _type _isStdio autoClose pending closed destroyed writable writableFinished writableObjectMode writableBuffer writableEnded writableNeedDrain writableHighWaterMark writableCorked writableLength errored writableAborted _eventsCount",
  in: "start end pos bytesRead _events _readableState _maxListeners _eventsCount autoClose pending readable readableDidRead readableAborted readableHighWaterMark readableBuffer readableFlowing readableLength readableObjectMode readableEncoding errored closed destroyed readableEnded",
};
const absent = "nothing extra then toJSON inspect length name prototype 0 setRawMode getColorDepth writeSync readSync";
for (const [short, which] of [
  ["out", "out"],
  ["err", "out"],
  ["in", "in"],
]) {
  const stream = join("process.std", short);
  console.log(short + "\n" + new Function("const stream = " + stream + ";" + walk)());
  const ask = new Function(
    "name",
    "const stream = " + stream + "; return (name in stream) + ' ' + Reflect.has(stream, name);",
  );
  console.log(
    short,
    "has",
    state[which]
      .split(" ")
      .map(name => name + " " + ask(name))
      .join(", "),
  );
  const look = new Function(
    "name",
    "const stream = " +
      stream +
      "; return (name in stream) + ' ' + typeof stream[name] + ' ' + Object.hasOwn(stream, name) + ' ' + Reflect.getOwnPropertyDescriptor(stream, name);",
  );
  console.log(
    short,
    "lacks",
    absent
      .split(" ")
      .map(name => name + " " + look(name))
      .join(", "),
  );
  const same = new Function(
    "const stream = " +
      stream +
      "; return [stream.on === stream.addListener, stream.off === stream.removeListener, stream.on === Object.getPrototypeOf(stream).on, typeof stream.once, stream.emit.name].join(' ');",
  );
  console.log(short, "same", same());
}
for (const text of [
  "process.std@in.on('data', () => {})",
  "process.std@out.end()",
  "process.std@err.once('drain', () => {})",
  "process.std@in.read()",
]) {
  try {
    console.log(text, "=>", typeof new Function("return " + join(...text.split("@")))());
  } catch (error) {
    // The executable says what was left out. Plain Bun carries it out.
    console.log(text, "=>", /was not compiled into this executable/.test(error.message) ? "object" : String(error));
  }
}
process.exit(0);
