// A proxy lists a name that its target does not have, and has no trap for the read: the target answers with what it inherits.
const lying = new Proxy({ real: 1 }, {
  ownKeys() { return ["real", "constructor", "hasOwnProperty"]; },
  getOwnPropertyDescriptor(target, name) { return { value: 0, enumerable: true, configurable: true, writable: true }; },
});
function list(o) {
  const found = [];
  for (const name in o) found.push(name, typeof o[name], o[name] === Object);
  return found.join();
}
console.log(list(lying));
console.log(list({ plain: 1 }));
console.log(list(Object.create(lying)));
