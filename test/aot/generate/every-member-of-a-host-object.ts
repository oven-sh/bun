// The programs of every-member-of-a-host-object that are one text but for a few places.
import { family, programsOf } from "../generate";

export const programs = () =>
  programsOf({
    ...family(
      `every-member-of-bun-is-read.js	Bun	Bun).map(key => [key, kindOf(() => Bun	Bun	Bun) inLoop.push([key, kindOf(() => Bun	Bun).map(key => [key, kindOf(() => Reflect.get(Bun
every-member-of-console-is-read.js	console	console).map(key => [key, kindOf(() => console	console	console) inLoop.push([key, kindOf(() => console	console).map(key => [key, kindOf(() => Reflect.get(console
every-member-of-process-is-read.js	process	process).map(key => [key, kindOf(() => process	process	process) inLoop.push([key, kindOf(() => process	process).map(key => [key, kindOf(() => Reflect.get(process
every-member-of-the-global-object-is-read.js	the global object	globalThis).map(key => [key, kindOf(() => globalThis	globalThis	globalThis) inLoop.push([key, kindOf(() => globalThis	globalThis).map(key => [key, kindOf(() => Reflect.get(globalThis`,
      (
        a,
        b,
        c,
        d,
        e,
      ) => `// Every way to go over the members of ${a} reads each of them, and no read throws: what plain Bun answers is answered.

const kindOf = read => {
  try {
    return typeof read();
  } catch (error) {
    return "throws " + error.message;
  }
};
const digest = pairs => {
  const counts = {};
  const thrown = [];
  for (const [key, kind] of pairs) {
    if (kind.startsWith("throws")) thrown.push(String(key) + ": " + kind);
    else counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return JSON.stringify(counts) + " " + JSON.stringify(thrown);
};

console.log("keys", digest(Object.keys(${b}[key])])));
console.log("values", kindOf(() => Object.values(${c}).length));
console.log("entries", kindOf(() => Object.entries(${c}).length));
console.log("spread", kindOf(() => ({ ...${c} })));
console.log("assign", kindOf(() => Object.assign({}, ${c})));
const inLoop = [];
for (const key in ${d}[key])]);
console.log("for-in", digest(inLoop));
console.log("own keys", digest(Reflect.ownKeys(${e}, key))])));
console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(${c})));
console.log("JSON", kindOf(() => JSON.stringify(${c})));
`,
    ),
    ...family(
      `every-member-of-bun-is-read-once-it-is-in-unknown-hands.js	Bun	Bun	Bun).map(key => [key, kindOf(() => Bun	Bun) inLoop.push([key, kindOf(() => Bun	Bun).map(key => [key, kindOf(() => Reflect.get(Bun
every-member-of-console-is-read-once-it-is-in-unknown-hands.js	console	console	console).map(key => [key, kindOf(() => console	console) inLoop.push([key, kindOf(() => console	console).map(key => [key, kindOf(() => Reflect.get(console
every-member-of-process-is-read-once-it-is-in-unknown-hands.js	process	process	process).map(key => [key, kindOf(() => process	process) inLoop.push([key, kindOf(() => process	process).map(key => [key, kindOf(() => Reflect.get(process
every-member-of-the-global-object-is-read-once-it-is-in-unknown-hands.js	the global object	globalThis	globalThis).map(key => [key, kindOf(() => globalThis	globalThis) inLoop.push([key, kindOf(() => globalThis	globalThis).map(key => [key, kindOf(() => Reflect.get(globalThis`,
      (
        a,
        b,
        c,
        d,
        e,
      ) => `// As its neighbor without "in unknown hands". Here a store under a key that nobody knows may have hit any global, and a function that nobody knows has been handed ${a}.
globalThis[process.argv[5] ?? "nothing"] = JSON.parse(process.argv[6] ?? "0");
const functionNobodyKnows = globalThis[process.argv[7] ?? "Boolean"];
functionNobodyKnows(${b});

const kindOf = read => {
  try {
    return typeof read();
  } catch (error) {
    return "throws " + error.message;
  }
};
const digest = pairs => {
  const counts = {};
  const thrown = [];
  for (const [key, kind] of pairs) {
    if (kind.startsWith("throws")) thrown.push(String(key) + ": " + kind);
    else counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return JSON.stringify(counts) + " " + JSON.stringify(thrown);
};

function walk() {
  console.log("keys", digest(Object.keys(${c}[key])])));
  console.log("values", kindOf(() => Object.values(${b}).length));
  console.log("entries", kindOf(() => Object.entries(${b}).length));
  console.log("spread", kindOf(() => ({ ...${b} })));
  console.log("assign", kindOf(() => Object.assign({}, ${b})));
  const inLoop = [];
  for (const key in ${d}[key])]);
  console.log("for-in", digest(inLoop));
  console.log("own keys", digest(Reflect.ownKeys(${e}, key))])));
  console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(${b})));
  console.log("JSON", kindOf(() => JSON.stringify(${b})));
}

// The analysis comes to the walks long after it has seen the object leave.
let steps = 0;
function level1(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level2(count);
}
function level2(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level3(count);
}
function level3(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level4(count);
}
function level4(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level5(count);
}
function level5(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level6(count);
}
function level6(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level7(count);
}
function level7(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level8(count);
}
function level8(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level9(count);
}
function level9(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level10(count);
}
function level10(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level11(count);
}
function level11(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level12(count);
}
function level12(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level13(count);
}
function level13(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level14(count);
}
function level14(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level15(count);
}
function level15(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level16(count);
}
function level16(count) {
  for (let index = 0; index < count; index++) steps += index;
  return walk();
}
level1(process.argv.length);
`,
    ),
    ...family(
      `getters-of-a-buffer-that-an-emitter-hands-to-a-listener-are-read-under-computed-keys.js	An emitter hands a buffer to a listener	const emitter = new (process.getBuiltinModule("node:events"))(); emitter.on("x", show); emitter.emit("x", Buffer.from("abc"));
getters-of-a-buffer-that-random-bytes-hands-to-its-callback-are-read-under-computed-keys.js	crypto.randomBytes hands a buffer to its callback	process.getBuiltinModule("node:crypto").randomBytes(4, (error, bytes) => show(bytes));
getters-of-a-buffer-that-gzip-hands-to-its-callback-are-read-under-computed-keys.js	zlib.gzip hands a buffer to its callback	process.getBuiltinModule("node:zlib").gzip("abc", (error, bytes) => show(bytes));
getters-of-a-buffer-that-a-stream-hands-to-a-listener-are-read-under-computed-keys.js	A stream hands a buffer to a listener	process.getBuiltinModule("node:stream").Readable.from([Buffer.from("abc")]).on("data", show);
getters-of-a-buffer-that-a-function-nobody-knows-hands-back-are-read-under-computed-keys.js	A function that nobody knows hands a buffer back	show(globalThis[process.argv[5] ?? "Object"](Buffer.from("abc")));`,
      (
        a,
        b,
      ) => `// ${a}, and nobody knows the keys under which it is read. Two of them name accessors of Buffer.prototype whose getters are written in JavaScript.
// Reading an accessor calls its getter: each read answers what plain Bun answers.
const keys = [
  ["par", "ent"],
  ["off", "set"],
  ["byte", "Length"],
].map(parts => parts.join(""));
const describe = value => (typeof value === "object" ? Object.prototype.toString.call(value) : String(value));
function show(buffer) {
  for (const key of keys) {
    const { [key]: taken } = buffer;
    console.log(key, describe(buffer[key]), describe(Reflect.get(buffer, key)), describe(taken));
  }
}
${b}
`,
    ),
    ...family(
      `getters-of-a-buffer-that-an-emitter-hands-to-a-listener-are-read-under-computed-keys.json
getters-of-a-buffer-that-random-bytes-hands-to-its-callback-are-read-under-computed-keys.json
getters-of-a-buffer-that-gzip-hands-to-its-callback-are-read-under-computed-keys.json
getters-of-a-buffer-that-a-stream-hands-to-a-listener-are-read-under-computed-keys.json
getters-of-a-buffer-that-a-function-nobody-knows-hands-back-are-read-under-computed-keys.json`,
      () => `{ "skipInShell": "it asks for objects of the host, which the jsc shell does not provide" }\n`,
    ),
  });
