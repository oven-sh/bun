import { posix } from "path";
import { bench, run } from "../runner.mjs";

const pathConfigurations = [
  ["", ""],
  [".", "."],
  ["/foo/bar", "/foo/bar"],
  ["/foo/bar/baz", "/foo/bar"],
  ["/foo/bar", "/foo/bar/baz"],
  ["/foo/bar/baz", "/foo/bar/qux"],
  ["/foo/bar/baz", "/foo/bar/baz/qux"],
  ["/foo/bar/baz", "/foo/bar/baz/qux/quux"],
  ["/", "/foo"],
  ["/foo", "/"],
  ["foo/bar/baz", "foo/bar/qux"],
  ["../foo/bar", "../foo/baz"],
  // Latin-1 characters in 8-bit strings.
  ["/foo/\u00e9t\u00e9/baz", "/foo/\u00e9t\u00e9/qux"],
  // UTF-16 code units.
  ["/foo/\u30d5\u30a9\u30eb\u30c0/baz", "/foo/\u30d5\u30a9\u30eb\u30c0/qux"],
  // A 16-bit string and an 8-bit one.
  ["/foo/\u30d5\u30a9\u30eb\u30c0/baz", "/foo/bar"],
  // An unpaired surrogate.
  ["/foo/\ud800/baz", "/foo/\ud800/qux"],
];

pathConfigurations.forEach(([from, to]) => {
  bench(`relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`, () => {
    globalThis.abc = posix.relative(from, to);
  });
});

await run();
