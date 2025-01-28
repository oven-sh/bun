import { bench, run } from "../runner.mjs";

var short = new TextEncoder().encode("Hello World!");
var shortUTF16 = new TextEncoder().encode("Hello World 💕💕💕");
var long = new TextEncoder().encode("Hello World!".repeat(1024));
var longUTF16 = new TextEncoder().encode("Hello World 💕💕💕".repeat(1024));
var decoder = new TextDecoder();
bench(`${short.length} ascii`, () => {
  decoder.decode(short);
});

bench(`${short.length} utf8`, () => {
  decoder.decode(shortUTF16);
});

bench(`${long.length} ascii`, () => {
  decoder.decode(long);
});

bench(`${longUTF16.length} utf8`, () => {
  decoder.decode(longUTF16);
});

if ("Buffer" in globalThis) {
  const buffer_short = Buffer.from(short);
  bench(`Buffer ${buffer_short.length} ascii`, () => {
    buffer_short.toString("ascii");
  });

  const buffer_shortUTF16 = Buffer.from(short);
  bench(`Buffer ${buffer_shortUTF16.length} utf8`, () => {
    buffer_shortUTF16.toString("utf8");
  });

  const buffer_long = Buffer.from(long);
  bench(`Buffer ${buffer_long.length} ascii`, () => {
    buffer_long.toString("ascii");
  });

  const buffer_longUTF16 = Buffer.from(longUTF16);
  bench(`Buffer ${buffer_longUTF16.length} utf8`, () => {
    buffer_longUTF16.toString("utf8");
  });
}

await run();
