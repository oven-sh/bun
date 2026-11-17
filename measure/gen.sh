#!/bin/bash
# Writes the fixtures for the instruction counts. Each calls one assertion 300 times on the same two values.
w() { cat > "$1"; }
w pass3.test.js <<'J'
import { expect, test } from "bun:test";
const d = new Date(0);
const received = { a: d, b: d, c: "hello" };
const expected = { a: expect.any(Date), b: expect.any(Date), c: "hello" };
test("pass3", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
J
w pass10.test.js <<'J'
import { expect, test } from "bun:test";
const d = new Date(0);
const received = { k0: 0, k1: 1, k2: 2, k3: 3, a: d, k4: 4, k5: 5, k6: 6, b: d, k7: 7 };
const expected = { k0: 0, k1: 1, k2: 2, k3: 3, a: expect.any(Date), k4: 4, k5: 5, k6: 6, b: expect.any(Date), k7: 7 };
test("pass10", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
J
w plain3.test.js <<'J'
import { expect, test } from "bun:test";
const received = { a: 1, b: 2, c: "hello" };
const expected = { a: 1, b: 2, c: "hello" };
test("plain3", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
J
w plain10.test.js <<'J'
import { expect, test } from "bun:test";
const received = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };
const expected = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };
test("plain10", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
J
w matchers10.test.js <<'J'
import { expect, test } from "bun:test";
const received = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };
const n = expect.any(Number);
const expected = { k0: n, k1: n, k2: n, k3: n, k4: n, k5: n, k6: n, k7: n, k8: n, k9: n };
test("matchers10", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
J
w not3.test.js <<'J'
import { expect, test } from "bun:test";
const d = new Date(0);
const received = { a: "foobar", b: d, c: "hello" };
const expected = { a: expect.any(Date), b: expect.any(Date), c: "hello" };
test("not3", () => {
  for (let i = 0; i < 300; i++) expect(received).not.toMatchObject(expected);
});
J
w deepmatch.test.js <<'J'
import { expect, test } from "bun:test";
const subset = { a: 1, b: 2, c: "hello" };
const object = { a: 1, b: 2, c: "hello", d: 4 };
test("deepmatch", () => {
  let all = true;
  for (let i = 0; i < 300; i++) all = Bun.deepMatch(subset, object) && all;
  expect(all).toBe(true);
});
J
w containing.test.js <<'J'
import { expect, test } from "bun:test";
const d = new Date(0);
const received = [{ a: d, b: 1 }];
const expected = [expect.objectContaining({ a: expect.any(Date) })];
test("containing", () => {
  for (let i = 0; i < 300; i++) expect(received).toEqual(expected);
});
J
w snapshot.test.js <<'J'
import { expect, test } from "bun:test";
const d = new Date(0);
const received = { a: d, b: 1, c: "hello" };
const matchers = { a: expect.any(Date) };
test("snapshot", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchSnapshot(matchers);
});
J
w fail-repro.test.js <<'J'
import { expect, test } from "bun:test";
const d = new Date(0);
const received = { a: "foobar", b: d, c: "hello" };
const expected = { a: expect.any(Date), b: expect.any(Date), c: "hello" };
test("fail-repro", () => {
  let failed = 0;
  for (let i = 0; i < 300; i++) {
    try {
      expect(received).toMatchObject(expected);
    } catch {
      failed++;
    }
  }
  expect(failed).toBe(300);
});
J
w fail-10.test.js <<'J'
import { expect, test } from "bun:test";
const received = { a: "foobar", k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };
const n = expect.any(Number);
const expected = { a: expect.any(Date), k1: n, k2: n, k3: n, k4: n, k5: n, k6: n, k7: n, k8: n, k9: n };
test("fail-10", () => {
  let failed = 0;
  for (let i = 0; i < 300; i++) {
    try {
      expect(received).toMatchObject(expected);
    } catch {
      failed++;
    }
  }
  expect(failed).toBe(300);
});
J
w fail-last.test.js <<'J'
import { expect, test } from "bun:test";
const received = { k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9, a: "foobar" };
const n = expect.any(Number);
const expected = { k1: n, k2: n, k3: n, k4: n, k5: n, k6: n, k7: n, k8: n, k9: n, a: expect.any(Date) };
test("fail-last", () => {
  let failed = 0;
  for (let i = 0; i < 300; i++) {
    try {
      expect(received).toMatchObject(expected);
    } catch {
      failed++;
    }
  }
  expect(failed).toBe(300);
});
J
