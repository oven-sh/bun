// A spread copies every member of `Bun`, then another copies every member of `process`. The keys of the second copy and of `process` are listed.
// Alone: the order of the keys follows from which members were read first, and the other programs of a joined executable read some
const copyOfBun = { ...Bun };
const copyOfProcess = { ...process };
console.log(Object.keys(copyOfBun).length > 0);
console.log(Reflect.ownKeys(copyOfProcess).map(String).join(" "));
console.log(Reflect.ownKeys(process).map(String).join(" "));
