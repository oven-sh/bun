import { aotNameClass } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { test } from "../supported";
import vectors from "./name-classes.json";

const data = { value: 1, writable: true, enumerable: true, configurable: true };

function isIndex(text: string) {
  const array: unknown[] = [];
  Reflect.defineProperty(array, text, data);
  return array.length > 0;
}

function isCanonicalNumericKey(text: string) {
  return !Reflect.defineProperty(new Uint8Array(0), text, data);
}

test("classifyName gives every vector its class", () => {
  expect(vectors.map(v => ({ text: v.text, class: aotNameClass(v.text) }))).toEqual(vectors);
});

test("every class except Private and EnginePrivate has a vector and no text repeats", () => {
  expect([...new Set(vectors.map(v => v.class))].sort()).toEqual([
    "Bind",
    "CallOrApply",
    "CanonicalNumericString",
    "Constructor",
    "Index",
    "LastIndex",
    "Length",
    "ObjectPrototypeMember",
    "Ordinary",
    "Proto",
    "Prototype",
    "Then",
    "ToJSON",
  ]);
  expect(new Set(vectors.map(v => v.text)).size).toBe(vectors.length);
});

test("the vectors agree with the engine", () => {
  expect(vectors.filter(v => isIndex(v.text) !== (v.class === "Index"))).toEqual([]);
  expect(
    vectors.filter(
      v => isCanonicalNumericKey(v.text) !== (v.class === "Index" || v.class === "CanonicalNumericString"),
    ),
  ).toEqual([]);
});

test("the names on Object.prototype", () => {
  const keys = Reflect.ownKeys(Object.prototype)
    .filter(key => typeof key === "string")
    .sort();
  const onObjectPrototype = ["Proto", "Constructor", "ObjectPrototypeMember"];
  expect(
    vectors
      .filter(v => onObjectPrototype.includes(v.class))
      .map(v => v.text)
      .sort(),
  ).toEqual(keys);
});
