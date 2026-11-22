// Bun.Image's WebP codec (src/webp), one line per case: best time in milliseconds.
//
//   bun run build:release bench/image/bench-webp.mjs
//
// There is nothing to compare with in here: run it with the build before a change and the one after. Use release
// builds. What the compiler makes of the loops in src/webp depends on how it is run, and a release build optimizes the
// crates at link time.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const images = join(import.meta.dir, "../../docs/images");
// Stored, so that getting at the pixels costs next to nothing.
const stored = image => image.png({ compressionLevel: 0 }).bytes();
const open = name => new Bun.Image(readFileSync(join(images, name)));
const photo = name => open(`../../test/js/node/test/fixtures/${name}.jpg`);
const screenshots = readdirSync(images, { recursive: true })
  .filter(name => name.endsWith(".png"))
  .sort()
  .filter((_, i) => i % 8 === 0);

const subjects = {
  "a soft photo": [await stored(photo("person-large"))],
  "that with 256 colors": [await stored(new Bun.Image(await photo("person-large").png({ palette: true }).bytes()))],
  "30 small, sharp photos": Array(30).fill(await stored(photo("person"))),
  "100 logos with transparency": Array(100).fill(await stored(open("../logo/bun.png"))),
  [`${screenshots.length} screenshots`]: await Promise.all(screenshots.map(name => stored(open(name)))),
  "200 thumbnails": Array(200).fill(await stored(photo("person").resize(64, 64))),
};

async function report(name, rounds, files, fn) {
  let best = Infinity;
  for (let i = 0; i < rounds; i++) {
    const start = Bun.nanoseconds();
    for (const file of files) await fn(file);
    best = Math.min(best, Bun.nanoseconds() - start);
  }
  console.log(`${(best / 1e6).toFixed(1).padStart(9)}  ${name}`);
}

// Next to nothing but the decoding.
const decode = file => stored(new Bun.Image(file).resize(1, 1, { filter: "nearest" }));

for (const [subject, files] of Object.entries(subjects)) {
  for (const options of [{ quality: 50 }, { quality: 80 }, { quality: 95 }, { lossless: true }]) {
    const setting = options.lossless ? "lossless" : `quality ${options.quality}`;
    const encode = file => new Bun.Image(file).webp(options).bytes();
    await report(`encode ${subject}, ${setting}`, 3, files, encode);
    await report(`decode ${subject}, ${setting}`, 9, await Promise.all(files.map(encode)), decode);
  }
}
