const buffer = Buffer.from([1, 2, 3]);
const part = buffer.slice(1);
part[0] = 9;
console.log(buffer[1] + 1, part.length);
