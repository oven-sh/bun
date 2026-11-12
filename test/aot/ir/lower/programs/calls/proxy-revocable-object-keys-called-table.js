// RUN: lower
// OPTIONS: builtin-modules

// Proxy revocable or object keys is called out of a table by index.
for (const index of [Number(process.argv.length > 99), Number(process.argv.length < 99)]) {
  console.log([Object.keys, Proxy.revocable][index]({}, {}).length);
}
