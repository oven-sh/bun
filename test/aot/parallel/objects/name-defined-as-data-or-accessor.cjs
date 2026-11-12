// COUNTER: FieldsEvictedByRedefinition = 1
"use strict";
// One site defines the name as a data property, another as an accessor. The slot is planned for the data property, and objects with the accessor keep it outside of the slot.
function make(type, props) {
  const ref = props.ref;
  const element = { type, props };
  if (ref !== undefined) Object.defineProperty(element, "ref", { enumerable: false, get: () => ref + 1 });
  else Object.defineProperty(element, "ref", { enumerable: false, value: null });
  Object.defineProperty(element, "info", { configurable: false, enumerable: false, writable: true, value: type });
  Object.freeze(element);
  return element;
}
let said = 0;
for (let turn = 0; turn < 2000; turn++) {
  const element = make("t" + (turn & 7), { turn });
  said = (said + (element.ref === null ? 1 : 100) + element.info.length + element.props.turn) % 1000003;
}
const plain = make("plain", {}), other = make("other", { ref: 4 });
for (const element of [plain, other]) {
  const found = Object.getOwnPropertyDescriptor(element, "ref");
  let store;
  try { element.ref = 5; store = "taken"; } catch (error) { store = error.constructor.name; }
  console.log(element.ref, typeof found.get, found.writable, found.enumerable, found.configurable, Object.getOwnPropertyNames(element).join(), Object.keys(element).join(), JSON.stringify(element), store, Object.isFrozen(element));
}
console.log(said);
