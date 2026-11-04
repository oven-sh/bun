// What a known import() gives is read, called and read again: an export changes its type and its function between the reads, and the object is the one that `import *` would give.
// Under: --aot-testing=CheckProofsAtRunTime: what the names of the namespace object hold behind the wait on a known import()
async function deed() {
  const library = await import("./library.mjs");
  const before = typeof library.value + " " + String(library.value) + " " + library.act();
  library.change();
  return before + " | " + typeof library.value + " " + String(library.value) + " " + library.act();
}
async function same() {
  const [one, two] = [await import("./library.mjs"), await import("./library.mjs")];
  return [one === two, Object.keys(one).join(), Object.isExtensible(one), Reflect.set(one, "value", 1)].join(" ");
}
console.log(await deed());
console.log(await deed());
console.log(await same());
for (let i = 0; i < 100; i++) await deed();
console.log(await deed());
