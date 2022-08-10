import { run, bench } from "mitata";
import { gzipSync, gunzipSync } from "bun";

const data = new TextEncoder().encode("Hello World!".repeat(9999));

const compressed = gzipSync(data);

bench(`roundtrip - "Hello World!".repeat(9999))`, () => {
  gunzipSync(gzipSync(data));
});

bench(`gzipSync("Hello World!".repeat(9999)))`, () => {
  gzipSync(data);
});

bench(`gunzipSync("Hello World!".repeat(9999)))`, () => {
  gunzipSync(compressed);
});

await run();
