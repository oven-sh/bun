// The key comes from outside, so the build does not know it.
const names = process.argv.length > 2 ? process.argv.slice(2) : ["write", "fd", "shelf"];
for (const name of names) console.log(name, name in process.stdout, name in process.stderr);
