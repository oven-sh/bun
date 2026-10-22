const buffer = Buffer.alloc(4);
console.log(buffer[0]);
buffer.fill("ab");
console.log(buffer[0], buffer[1], buffer[2] + 1);
