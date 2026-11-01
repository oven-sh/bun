process.argv.list = [1, 2];
Bun.argv.list = { length: 3 };
function read() { return process.argv.list.length; }
console.log(String(read()));
