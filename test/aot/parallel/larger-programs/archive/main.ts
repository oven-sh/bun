// An archive of files: a bit stream, dictionaries, prefix codes, sums, a tree of folders with entries that are added, listed, extracted and checked, in two modules
import { Sum, StoredCodec, RunsCodec, PackedCodec, Archive } from "./lib";
const archive = new Archive("made up ünïcode");
let seed = 3;
const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
for (let i = 0; i < 60; i++) {
  const kind = i % 5;
  const content = kind === 0 ? "lorem ipsum dolor ".repeat(5 + i * 3) : kind === 1 ? JSON.stringify(Array.from({ length: 30 + i },
    (_, k) => ({ id: k, name: "name" + (k % 7), tags: ["a",
    "b"].slice(k % 3) }))) : kind === 2 ? new Uint8Array(300 + i * 10).fill(i) : kind === 3 ? Uint8Array.from({ length: 200 + i },
    () => random(256)) : "";
  const e = archive.add(`${["src", "docs/deep", "img"][i % 3]}/file${i}.${["txt", "json", "bin", "raw", "none"][kind]}`,
    content as any, i * 100);
  if (i < 6) console.log(e.path, e.size, e.packed, e.method, e.sum.toString(16));
}
console.log(archive.sizes.join(" > "), archive.root.count, [...archive.list("docs/")].length,
  [...archive.list()].slice(0, 3).map(e => e.path).join());
let mixed = 0;
for (let round = 0; round < 8; round++) {
  const saved = archive.save(), back = Archive.load(saved);
  for (const e of back.list()) {
    const bytes = back.read(e.path);
    mixed = (mixed * 31 + Sum.crc(bytes) + bytes.length) >>> 0;
  }
  if (round === 0) console.log(saved.length, Sum.adler(saved), back.title,
    back.text("src/file0.txt").slice(0, 20), back.text("docs/deep/file1.json").length);
  archive.add("round/" + round, "round " + "x".repeat(round * 50));
  if (round % 3 === 2) archive.remove("img/file" + (round * 3 + 2) + ".bin");
}
console.log(mixed, archive.root.count);
const saved = archive.save();
const attempts: [string, () => unknown][] = [["short", () => Archive.load(saved.slice(0, 5))],
  ["magic", () => Archive.load(Uint8Array.from(saved, (v, i) => (i === 0 ? v ^ 1 : v)))],
  ["flipped", () => Archive.load(Uint8Array.from(saved, (v, i) => (i === 400 ? v ^ 4 : v)))],
  ["path", () => archive.add("../x", "")], ["folder", () => archive.add("src", "x")], ["none",
  () => archive.read("src/none")], ["code", () => new PackedCodec().unpack(Uint8Array.of(1, 2,
  3), 10)], ["stored", () => new StoredCodec().unpack(Uint8Array.of(1), 2)], ["runs",
  () => new RunsCodec().unpack(Uint8Array.of(9, 1), 2)]];
for (const [name, f] of attempts) try {
  f();
  console.log(name, "fine");
} catch (e) {
  console.log(name, (e as Error).name, (e as Error).message);
}
