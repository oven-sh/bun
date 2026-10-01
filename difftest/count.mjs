// argv: tarball, dest, "1" to extract / "0" to only load (baseline for subtraction)
const [tar, dest, doExtract] = process.argv.slice(2);
const bytes = await Bun.file(tar).bytes();
const archive = new Bun.Archive(bytes);
if (doExtract === "1") {
  const n = await archive.extract(dest);
  if (n < 2000) throw new Error("unexpected count " + n);
}
