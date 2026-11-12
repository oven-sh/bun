import * as assert from "assert";
import { bench, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

function chain(depth) {
  let node = { value: depth };
  for (let i = depth - 1; i >= 0; i--) node = { value: i, next: node };
  return node;
}

function tree(parentOf) {
  const root = { type: "Program", body: [] };
  for (let i = 0; i < 20; i++) {
    root.body.push({ type: "Statement", index: i, loc: { line: i, column: 0 }, ...parentOf(root) });
  }
  return root;
}

const chains = [chain(64), chain(64)];
const trees = [tree(() => ({})), tree(() => ({}))];
const treesWithParent = [tree(parent => ({ parent })), tree(parent => ({ parent }))];
const partOfTreeWithParent = tree(() => ({ parent: { type: "Program" } }));

bench("partialDeepStrictEqual", () => {
  assert.partialDeepStrictEqual({ foo: "123", bar: { baz: [1, 2, 3] }, beep: "boop" }, { bar: { baz: [2, 3] } });
});

bench("partialDeepStrictEqual (chain of 64)", () => {
  assert.partialDeepStrictEqual(chains[0], chains[1]);
});

bench("partialDeepStrictEqual (tree of 20)", () => {
  assert.partialDeepStrictEqual(trees[0], trees[1]);
});

bench("partialDeepStrictEqual (tree of 20, parent links in actual)", () => {
  assert.partialDeepStrictEqual(treesWithParent[0], partOfTreeWithParent);
});

bench("partialDeepStrictEqual (tree of 20, parent links in both)", () => {
  assert.partialDeepStrictEqual(treesWithParent[0], treesWithParent[1]);
});

await run();
