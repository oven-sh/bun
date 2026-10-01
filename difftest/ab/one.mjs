// argv: tarball, dest. Prints the extraction time in microseconds.
const [tar, dest] = process.argv.slice(2);
const archive = new Bun.Archive(await Bun.file(tar).bytes());
const t0 = Bun.nanoseconds();
const n = await archive.extract(dest);
const t1 = Bun.nanoseconds();
console.log(Math.round((t1 - t0) / 1000), n);
