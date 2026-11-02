// The program takes `write` from a standard stream and calls it on something else: the stream for input, a prototype, any object.
// Only a stream for output has somewhere to write to. On every other receiver plain Bun throws, and says what it found.
const write = process.stdout.write;
const tries = [
  ["write.call(process.stdin, 'x')", () => write.call(process.stdin, 'x')],
  ["write.call(process.stdin, 'x', () => {})", () => write.call(process.stdin, 'x', () => {})],
  ["write.call(process.stdin, 'x', 'utf8', () => {})", () => write.call(process.stdin, 'x', 'utf8', () => {})],
  ['write.call(process.stdin)', () => write.call(process.stdin)],
  ["Reflect.apply(write, process.stdin, ['x'])", () => Reflect.apply(write, process.stdin, ['x'])],
  ["write.bind(process.stdin)('x')", () => write.bind(process.stdin)('x')],
  ["write.call(Object.getPrototypeOf(process.stdin), 'x')", () => write.call(Object.getPrototypeOf(process.stdin), 'x')],
  ["write.call(Object.create(process.stdin), 'x')", () => write.call(Object.create(process.stdin), 'x')],
  ["process.stderr.write.call(process.stdin, 'x')", () => process.stderr.write.call(process.stdin, 'x')],
  ["write.call(Object.getPrototypeOf(process.stdout), 'x')", () => write.call(Object.getPrototypeOf(process.stdout), 'x')],
  ["write.call(Object.getPrototypeOf(Object.getPrototypeOf(process.stdout)), 'x')", () => write.call(Object.getPrototypeOf(Object.getPrototypeOf(process.stdout)), 'x')],
  ["write.call(Object.create(Object.getPrototypeOf(process.stdout)), 'x')", () => write.call(Object.create(Object.getPrototypeOf(process.stdout)), 'x')],
  ["write.call({}, 'x')", () => write.call({}, 'x')],
  ["write.call([], 'x')", () => write.call([], 'x')],
  ["write.call(() => {}, 'x')", () => write.call(() => {}, 'x')],
  ["write.call(1, 'x')", () => write.call(1, 'x')],
  ["write.call('s', 'x')", () => write.call('s', 'x')],
  ["write.call(Symbol.iterator, 'x')", () => write.call(Symbol.iterator, 'x')],
  ["write.call(null, 'x')", () => write.call(null, 'x')],
  ["write.call(undefined, 'x')", () => write.call(undefined, 'x')],
  ["write.call(new Proxy({}, {}), 'x')", () => write.call(new Proxy({}, {}), 'x')],
  ["write.call(new Proxy(process.stdin, {}), 'x')", () => write.call(new Proxy(process.stdin, {}), 'x')],
  ["write.call(Object.create(null), 'x')", () => write.call(Object.create(null), 'x')],
  ["write.call({ _write: 1 }, 'x')", () => write.call({ _write: 1 }, 'x')],
  ["write.call({ _write: 's' }, 'x')", () => write.call({ _write: 's' }, 'x')],
  ["write.call({ _write: null }, 'x')", () => write.call({ _write: null }, 'x')],
  ["write.call({ _write: {} }, 'x')", () => write.call({ _write: {} }, 'x')],
  ["write.call({ _write: [] }, 'x')", () => write.call({ _write: [] }, 'x')],
  ["write.call({ _writableState: null }, 'x')", () => write.call({ _writableState: null }, 'x')],
  ["write.call({ _writableState: 1 }, 'x')", () => write.call({ _writableState: 1 }, 'x')],
  ["write.call({ _writableState: {} }, 'x')", () => write.call({ _writableState: {} }, 'x')],
  ["write.call({ get _write() { throw new RangeError('from a getter'); } }, 'x')", () => write.call({ get _write() { throw new RangeError('from a getter'); } }, 'x')],
  ["write.call({ get _writableState() { throw new RangeError('from the state'); } }, 'x')", () => write.call({ get _writableState() { throw new RangeError('from the state'); } }, 'x')],
  ["write.call(process.stdout, 'to the first\\n')", () => write.call(process.stdout, 'to the first\n')],
  ["process.stderr.write.call(process.stdout, 'to the first again\\n')", () => process.stderr.write.call(process.stdout, 'to the first again\n')],
  ["write.call(Object.create(process.stdout), 'through an heir\\n')", () => write.call(Object.create(process.stdout), 'through an heir\n')],
  ["write.call(Object.create(Object.create(process.stdout)), 'through the heir of an heir\\n')", () => write.call(Object.create(Object.create(process.stdout)), 'through the heir of an heir\n')],
  ["write('as ever\\n')", () => write('as ever\n')],
];
for (const [text, ask] of tries) {
  try { console.log(text, "=>", ask()); } catch (error) { console.log(text, "threw", error.constructor.name, error.code, error.message); }
}
for (const stream of [process.stdout, process.stderr, process.stdin]) {
  const answers = [];
  for (let at = stream; at; at = Object.getPrototypeOf(at)) {
    try { answers.push(String(write.call(at, "a level writes\n"))); } catch (error) { answers.push(error.constructor.name + " " + error.code + " " + error.message); }
  }
  console.log(answers.join("\n  "));
}
console.log("the program goes on");
