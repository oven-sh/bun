// Bun.inspect() describes the global object, `Bun` within it. Then a spread copies `process`, and the keys of the copy are listed.
console.log(Bun.inspect(globalThis).length > 0);
console.log(Reflect.ownKeys({ ...process }).map(String).join(" "));
