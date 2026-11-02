function install({ target, proto }, members) {
  const object = proto ? globalThis[target].prototype : globalThis;
  for (const key of Reflect.ownKeys(members)) Object.defineProperty(object, key, { value: members[key], writable: true, configurable: true });
}
install({ target: "Array", proto: true }, {
  groupedByTheProgram(keyOf) { const groups = {}; for (const value of this) (groups[keyOf(value)] ??= []).push(value); return groups; },
});
console.log(JSON.stringify([1, 2, 3].groupedByTheProgram(value => (value & 1 ? "odd" : "even"))));
