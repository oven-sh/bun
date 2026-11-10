const got = [];
const other = { _writableState: undefined, _write(data, encoding, done) { got.push(String(data)); } };
try { process.stdout.write.call(other, "for the other\n"); } catch (error) { console.log(error.name); }
console.log(got.length);
const bound = process.stdout.write.bind(process.stdout);
bound("through a bound function\n");
