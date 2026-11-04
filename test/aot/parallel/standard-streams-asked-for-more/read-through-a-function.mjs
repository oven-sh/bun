const take = stream => stream.writableLength;
console.log(take(process.stdout));
