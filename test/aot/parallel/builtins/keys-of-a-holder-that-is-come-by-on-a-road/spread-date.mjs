// A spread makes the holder whole. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [typeof Date.UTC(2000, 1), typeof Date.now()];
const copy = { ...Date }; console.log(first.length, Object.keys(copy).join(), Object.getOwnPropertyNames(Date).join());
