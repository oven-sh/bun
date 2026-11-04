// A closure hands the holder out. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [JSON.stringify(1), JSON.parse("2")];
const give = () => JSON; const holder = give();
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
