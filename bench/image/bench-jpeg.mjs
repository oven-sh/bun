// Bun.Image's JPEG codec (src/jpeg), one line per case: best time in milliseconds.
//
//   bun run build:release bench/image/bench-jpeg.mjs [more.jpg ...]
//
// There is nothing to compare with in here: run it with the build before a change and the one after. Use release
// builds. What the compiler makes of the loops in src/jpeg depends on how it is run, and a release build optimizes the
// crates at link time.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

async function report(name, fn) {
  let best = Infinity;
  for (let i = 0; i < 20; i++) {
    const start = Bun.nanoseconds();
    await fn();
    best = Math.min(best, Bun.nanoseconds() - start);
  }
  console.log(`${(best / 1e6).toFixed(2).padStart(9)}  ${name}`);
}

const each = (files, fn) => async () => {
  for (const file of files) await fn(file);
};

/** Next to nothing but the decoding. The height pins the scale to `eighths` / 8. */
async function decoder(jpeg, eighths) {
  const height = Math.ceil(((await new Bun.Image(jpeg).metadata()).height * eighths) / 8);
  return file =>
    new Bun.Image(file).resize(1, height, { fit: "fill", filter: "nearest" }).png({ compressionLevel: 0 }).bytes();
}

// A CPU learns the branches of a file that it decodes over and over, so each case has several.
const variants = [
  image => image,
  image => image.flip(),
  image => image.flop(),
  image => image.rotate(180),
  image => image.modulate({ brightness: 0.8 }),
  image => image.modulate({ saturation: 1.5 }).flop(),
];
const docs = join(import.meta.dir, "../../docs/images");
for (const [name, path, width] of [
  ["photos", "cat.jpg", 1200],
  ["photos", "cat.jpg", 600],
  ["thumbnails", "cat.jpg", 128],
  ["screenshots", "chrome-devtools-memory.png", 1600],
]) {
  const source = readFileSync(join(docs, path));
  // Stored, so that reading them costs little.
  const pngs = await Promise.all(
    variants.map(vary => vary(new Bun.Image(source).resize(width)).png({ compressionLevel: 0 }).bytes()),
  );
  const what = `${pngs.length} ${name}, ${width} wide`;
  const read = png => new Bun.Image(png).resize(1, 1, { filter: "nearest" }).png({ compressionLevel: 0 }).bytes();
  await report(`read ${what}, as PNG`, each(pngs, read));
  for (const progressive of [false, true]) {
    for (const quality of [50, 80, 95]) {
      const how = `quality ${quality}${progressive ? ", progressive" : ""}`;
      const encode = png => new Bun.Image(png).jpeg({ quality, progressive }).bytes();
      await report(`read ${what}, as PNG and encode them, ${how}`, each(pngs, encode));
      const jpegs = await Promise.all(pngs.map(encode));
      for (const eighths of [8, 5, 4, 1]) {
        await report(`decode ${what}, ${how}, at ${eighths}/8`, each(jpegs, await decoder(jpegs[0], eighths)));
      }
    }
  }
}

for (const path of process.argv.slice(2)) {
  const jpeg = readFileSync(path);
  for (const eighths of [8, 4, 1]) {
    const decode = await decoder(jpeg, eighths);
    await report(`decode ${basename(path)} at ${eighths}/8`, () => decode(jpeg));
  }
}
