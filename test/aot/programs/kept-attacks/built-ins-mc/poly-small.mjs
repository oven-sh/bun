// Built ins mc: poly small. It prints what plain Bun prints.
function install(target, members) {
  const object = globalThis[target].prototype;
  for (const key of Reflect.ownKeys(members)) {
    if (key in object) continue;
    Object.defineProperty(object, key, { value: members[key], enumerable: false, writable: true, configurable: true });
  }
}
install("Array", { lastOfTheProgram() { return this[this.length - 1]; } });
install("Function", { demethodize() { return 1; } });
console.log([1, 2].lastOfTheProgram(), (function () {}).demethodize());
