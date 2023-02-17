import { bench, run } from "../node_modules/mitata/src/cli.mjs";

// pure JS implementation will optimze this out
// bench("new Headers", function () {
//   return new Headers();
// });

var big = new Headers({
  "Content-Type": "text/plain",
  "Content-Length": "123",
  hello: "there",
  "X-Custom-Header": "Hello World",
  "X-Another-Custom-Header": "Hello World",
  "X-Yet-Another-Custom-ader": "Hello World",
  "X-Yet-Another-Custom-Heder": "Hello World",
  "X-Yet-Another-Custom-Heade": "Hello World",
  "X-Yet-Another-Custom-Headz": "Hello Worlda",
});

// bench("Header.get", function () {
//   return big.get("Content-Type");
// });

// bench("Header.set (standard)", function () {
//   return big.set("Content-Type", "text/html");
// });

// bench("Header.set (non-standard)", function () {
//   return big.set("X-My-Custom", "text/html123");
// });

if (big.toJSON)
  bench("Headers.toJSON", function () {
    return big.toJSON();
  });

bench("Object.fromEntries(headers.entries())", function () {
  return Object.fromEntries(big.entries());
});

bench("Object.fromEntries(headers)", function () {
  return Object.fromEntries(big);
});

run();
