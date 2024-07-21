import { run, bench, group } from "mitata";
import { gzipSync, gunzipSync } from "bun";

const data = new TextEncoder().encode("Hello World!".repeat(9999));

const compressed = gzipSync(data);

const libraries = ["zlib"];
if (Bun.semver.satisfies(Bun.version, ">=1.1.21")) {
  libraries.push("libdeflate");
}

const options = { library: undefined };
const benchFn = (name, fn) => {
  if (libraries.length > 1) {
    group(name, () => {
      for (const library of libraries) {
        bench(library, () => {
          options.library = library;
          fn();
        });
      }
    });
  } else {
    bench(name, () => {
      fn();
    });
  }
};

benchFn(`roundtrip - "Hello World!".repeat(9999))`, () => {
  gunzipSync(gzipSync(data, options), options);
});

benchFn(`gzipSync("Hello World!".repeat(9999)))`, () => {
  gzipSync(data, options);
});

benchFn(`gunzipSync("Hello World!".repeat(9999)))`, () => {
  gunzipSync(compressed, options);
});

await run();
