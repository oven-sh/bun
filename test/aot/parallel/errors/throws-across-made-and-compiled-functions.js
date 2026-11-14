// Functions made from a text at run time run in the interpreter. A throw passes through their frames and through compiled ones, in every order, to a handler in either.
const glue = process.argv.length > 99 ? "x" : " "; // the build cannot know the texts
const make = (...parts) => new Function(...parts.slice(0, -1), parts.at(-1).join(glue));
const log = [];

const deep = make("n", "what", "deep", ["if (n === 0) throw what;", "return deep(n - 1, what, deep) + 1;"]);
try { deep(200, 7, deep); } catch (e) { log.push("through 200 made frames: " + e); }

function compiledThrows(what) { throw what; }
const callsBack = make("callee", "value", ["return callee(value)", "+ 1;"]);
try { callsBack(compiledThrows, "from compiled code"); } catch (e) { log.push("made above compiled: " + e); }

function withFinally(callee, ...rest) {
  try { return callee(...rest); } finally { log.push("finally of compiled code, " + rest.length); }
}
const madeWithFinally = make("callee", "log", "a", "b", "c", ["try { return callee(a, b, c); }", "finally { log.push('finally of a made function'); }"]);
try {
  withFinally(madeWithFinally, withFinally, log, madeWithFinally, compiledThrows, log);
} catch (e) { log.push("alternating: " + e); }

const madeCatches = make("callee", "value", ["try { return callee(value); }", "catch (e) { return 'a made function caught ' + e; }"]);
log.push(madeCatches(compiledThrows, 1));
log.push(madeCatches(value => callsBack(compiledThrows, value), 2));
log.push(madeCatches(value => [value].map(item => callsBack(compiledThrows, item)), 3));

const madeMaps = make("list", "callee", ["return list.map(", "item => callee(item));"]);
try { madeMaps([4], compiledThrows); } catch (e) { log.push("through a built-in called by a made function: " + e); }
try { [5].forEach(item => madeMaps([item], value => [value].forEach(compiledThrows))); } catch (e) { log.push("through three built-ins: " + e); }

function names(error) {
  const frames = error.stack.split("\n").filter(line => /^\s+at /.test(line));
  return frames.map(line => /at (?:new )?([\w.<>]+) \(/.exec(line)?.[1] ?? "module").slice(0, 7).join(" < ");
}
function compiledMakesError() { return new Error("traced"); }
function outer(callee) { return callee(compiledMakesError); }
const madeMiddle = make("callee", ["const result = callee();", "return result;"]);
log.push("trace: " + names(outer(madeMiddle)));
log.push("trace through two: " + names(outer(callee => madeMiddle(() => madeMiddle(callee)))));

const rejected = make("callee", ["return Promise.resolve().then(", "() => callee('late'));"]);
await rejected(compiledThrows).catch(e => log.push("in a job that a made function queued: " + e));
const madeAsync = make("callee", ["return (async () => { await null;", "return callee('awaited'); })();"]);
try { await madeAsync(compiledThrows); } catch (e) { log.push("out of a made async function: " + e); }

function* compiledGenerator(callee) { try { yield 1; callee("in a generator"); } finally { log.push("finally of a generator"); } }
const madeDrains = make("generator", ["let n = 0; for (const item of generator) n += item;", "return n;"]);
try { madeDrains(compiledGenerator(compiledThrows)); } catch (e) { log.push("a made function drains a generator: " + e); }

let overflow = 0;
const madeForever = make("self", ["return self(self)", "+ 1;"]);
try { madeForever(madeForever); } catch (e) { overflow++; log.push("the stack ends in made functions: " + e.name); }
console.log(log.join("\n"));
