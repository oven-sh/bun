import { readFileSync } from "fs";
import { createRequire } from "module";
import { gunzipSync, gzipSync } from "zlib";
import { bench, run } from "../runner.mjs";

const require = createRequire(import.meta.url);
const data = readFileSync(require.resolve("@babel/standalone/babel.min.js"));

const compressed = gzipSync(data);

bench(`roundtrip - @babel/standalone/babel.min.js)`, () => {
  gunzipSync(gzipSync(data));
});

bench(`gzipSync(@babel/standalone/babel.min.js))`, () => {
  gzipSync(data);
});

bench(`gunzipSync(@babel/standalone/babel.min.js))`, () => {
  gunzipSync(compressed);
});

await run();
