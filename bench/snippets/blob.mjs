import { bench, run } from "../runner.mjs";

bench("new Blob(['hello world'])", function () {
  return new Blob(["hello world"]);
});

var small = new Blob([JSON.stringify("hello world ")]);
bench("blob.text(small string)", function () {
  return small.text();
});

bench("blob.arrayBuffer(small string)", function () {
  return small.arrayBuffer();
});

// if (Blob.prototype.json) {
//   bench("blob.json(small string)", function () {
//     return small.json();
//   });
// }

bench("blob.slice()", function () {
  return small.slice();
});

// slice() shares the source's bytes, so this only differs from the small case
// by what each new Blob tells the GC.
var large = new Blob([new Uint8Array(8 * 1024 * 1024)]);
bench("blob.slice() (8 MiB blob)", function () {
  return large.slice();
});

if ((await small.text()) !== JSON.stringify("hello world ")) {
  throw new Error("blob.text() failed");
}

await run();
