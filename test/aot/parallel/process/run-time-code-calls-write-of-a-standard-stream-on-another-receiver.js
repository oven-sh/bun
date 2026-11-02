// Alone: beside a program that names a standard stream the executable holds what makes the whole stream
// The program names no standard stream. Code evaluated at run time takes `write` from one and calls it on something else: the stream for input, a prototype, any object.
// Only a stream for output has somewhere to write to. On every other receiver plain Bun throws, and the program goes on.
const join = (...parts) => parts.join(process.argv.length > 99 ? "x" : "");
const walk = `
  const answers = [];
  for (let at = stream; at; at = Object.getPrototypeOf(at)) {
    try { answers.push(String(write.call(at, "a level writes\\n"))); } catch (error) { answers.push(error.constructor.name + " " + error.code + " " + error.message); }
  }
  return answers.join("\\n  ");`;
const texts = [
  "write.call(process.std@in, 'x')", "write.call(process.std@in, 'x', () => {})", "write.call(process.std@in, 'x', 'utf8', () => {})", "write.call(process.std@in)",
  "Reflect.apply(write, process.std@in, ['x'])", "write.bind(process.std@in)('x')", "write.call(Object.getPrototypeOf(process.std@in), 'x')",
  "write.call(Object.create(process.std@in), 'x')", "process.std@err.write.call(process.std@in, 'x')",
  "write.call(Object.getPrototypeOf(process.std@out), 'x')", "write.call(Object.getPrototypeOf(Object.getPrototypeOf(process.std@out)), 'x')",
  "write.call(Object.create(Object.getPrototypeOf(process.std@out)), 'x')",
  "write.call({}, 'x')", "write.call([], 'x')", "write.call(() => {}, 'x')", "write.call(1, 'x')", "write.call('s', 'x')", "write.call(Symbol.iterator, 'x')", "write.call(null, 'x')", "write.call(undefined, 'x')",
  "write.call(new Proxy({}, {}), 'x')", "write.call(new Proxy(process.std@in, {}), 'x')", "write.call(Object.create(null), 'x')",
  "write.call({ _write: 1 }, 'x')", "write.call({ _write: 's' }, 'x')", "write.call({ _write: null }, 'x')", "write.call({ _write: {} }, 'x')", "write.call({ _write: [] }, 'x')",
  "write.call({ _writableState: null }, 'x')", "write.call({ _writableState: 1 }, 'x')", "write.call({ _writableState: {} }, 'x')",
  "write.call({ get _write() { throw new RangeError('from a getter'); } }, 'x')", "write.call({ get _writableState() { throw new RangeError('from the state'); } }, 'x')",
  "write.call(process.std@out, 'to the first\\n')", "process.std@err.write.call(process.std@out, 'to the first again\\n')", "write.call(Object.create(process.std@out), 'through an heir\\n')",
  "write.call(Object.create(Object.create(process.std@out)), 'through the heir of an heir\\n')", "write('as ever\\n')",
];
for (const text of texts) {
  const source = join("const write = process.std", "out.write; return ", ...text.split("@"));
  try { console.log(text, "=>", new Function(source)()); } catch (error) { console.log(text, "threw", error.constructor.name, error.code, error.message); }
}
for (const name of ["out", "err", "in"])
  console.log(name, "\n ", new Function(join("const write = process.std", "out.write, stream = process.std", name, ";", walk))());
console.log("the program goes on");
