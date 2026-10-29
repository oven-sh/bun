import { expect } from "bun:test";
import { findFailures, foldersOf, listFolders, testQueries } from "./checker-queries";
import { test } from "./with-compiler";

test("every folder of fixtures is asked by one test file", () => {
  expect(Object.values(foldersOf).flat().sort()).toEqual(listFolders());
});

test("`ordered:` lines fail when printed in another order", () => {
  const printed = ["a", "b", "c", "a"];
  expect(findFailures(["ordered: a", "ordered: c"], printed)).toEqual([]);
  expect(findFailures(["ordered: b", "ordered: a"], printed)).toEqual([]);
  expect(findFailures(["ordered: c", "ordered: b"], printed)).toEqual(["ordered: b: printed out of order"]);
  expect(findFailures(["ordered: c", "ordered: b", "ordered: a"], printed)).toEqual([
    "ordered: b: printed out of order",
  ]);
  expect(findFailures(["ordered: a", "ordered: d"], printed)).toEqual(["ordered: d"]);
  expect(findFailures(["ordered: c", "a", "ordered: b"], printed)).toEqual([]);
});

testQueries("calls");
