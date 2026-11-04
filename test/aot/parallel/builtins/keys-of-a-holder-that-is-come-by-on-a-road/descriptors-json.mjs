// The keys of all descriptors of the holder. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [JSON.stringify(1), JSON.parse("2")];
console.log(first.length, Object.keys(Object.getOwnPropertyDescriptors(JSON)).join());
