// Object.freeze is asked to freeze the holder. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Array.of(1).length, Array.from("ab").length];
try { Object.freeze(Array); } catch {} console.log(first.length, Object.getOwnPropertyNames(Array).join());
