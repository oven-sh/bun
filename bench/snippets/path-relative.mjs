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
];

pathConfigurations.forEach(([from, to]) => {
  bench(`relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`, () => {
    globalThis.abc = posix.relative(from, to);
  });
});

await run();
