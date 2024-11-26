import { gunzipSync, gzipSync } from "bun";
import { bench, group, run } from "../runner.mjs";

const data = await Bun.file(require.resolve("@babel/standalone/babel.min.js")).arrayBuffer();

const compressed = gzipSync(data);

const libraries = ["zlib"];
if (Bun.semver.satisfies(Bun.version.replaceAll("-debug", ""), ">=1.1.21")) {
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
    options.library = libraries[0];
    bench(name, () => {
      fn();
    });
  }
};

benchFn(`roundtrip - @babel/standalone/babel.min.js`, () => {
  gunzipSync(gzipSync(data, options), options);
});

benchFn(`gzipSync(@babel/standalone/babel.min.js`, () => {
  gzipSync(data, options);
});

benchFn(`gunzipSync(@babel/standalone/babel.min.js`, () => {
  gunzipSync(compressed, options);
});

await run();
