// One place of the list is read-only: the native takes the protocol.
const list = [9, 3, 3];
Object.defineProperty(list, 0, { value: 9, writable: false });
console.log(new Set(list).size);
