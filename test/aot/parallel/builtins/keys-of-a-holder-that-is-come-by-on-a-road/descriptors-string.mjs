// The keys of all descriptors of the holder. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [String.raw`a`, String.fromCodePoint(65)];
console.log(first.length, Object.keys(Object.getOwnPropertyDescriptors(String)).join());
