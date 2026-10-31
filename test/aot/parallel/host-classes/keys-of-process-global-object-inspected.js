// Bun.inspect() describes the global object, `Bun` within it. Then a spread copies `process`, and the keys of the copy are listed.
// Alone: the order of the keys follows from which members were read first, and the other programs of a joined executable read some
console.log(Bun.inspect(globalThis).length > 0);
console.log(Reflect.ownKeys({ ...process }).map(String).join(" "));
