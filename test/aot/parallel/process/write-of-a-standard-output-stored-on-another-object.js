const other = { write: process.stdout.write, _write: (data, encoding, cb) => (cb(null), true) };
console.log(other.write("x\n"), other.write === process.stdout.write, typeof other.write);
