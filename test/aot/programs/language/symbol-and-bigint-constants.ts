// A top-level Symbol() and a BigInt literal compile to constants: the symbol has one identity in every function, through an import and across collections, and every occurrence of the literal has the same value.
import { key as importedKey } from "./symbol-and-bigint-constants";

export const key: unique symbol = Symbol("k");
const otherKey: unique symbol = Symbol("k");

type Keyed = { [key]?: number };

function write(target: Keyed, value: number): void {
  target[key] = value;
}

function read(target: Keyed): number | undefined {
  return target[key];
}

function readThroughImport(target: Keyed): number | undefined {
  return target[importedKey];
}

function readKey(): symbol {
  return key;
}

function haveSameIdentity(left: symbol, right: symbol): boolean {
  return left === right;
}

const target: Keyed = {};
write(target, 7);
const ownSymbols = Object.getOwnPropertySymbols(target);
console.log("as a key:", read(target), readThroughImport(target), ownSymbols.length, ownSymbols[0] === key);
console.log("through an import:", importedKey === key, haveSameIdentity(readKey(), importedKey), typeof importedKey);
console.log("as text:", key.toString(), importedKey.description);

function hasSameIdentityAfterCollections(rounds: number): boolean {
  const first = readKey();
  let isSame = true;
  for (let i = 0; i < rounds; i++) {
    Bun.gc(true);
    isSame = isSame && readKey() === first && key === first && importedKey === first;
  }
  return isSame;
}
console.log("across collections:", hasSameIdentityAfterCollections(5), read(target), readThroughImport(target));

const keyedByBoth = { [key]: 1, [otherKey]: 2 };
console.log("two symbols, one description:", haveSameIdentity(key, otherKey), key.description === otherKey.description);
console.log("two keys:", keyedByBoth[key], keyedByBoth[otherKey], Object.getOwnPropertySymbols(keyedByBoth).length, otherKey in target);

function firstOccurrence(): bigint {
  return 1234567890123456789012345678901234567890n;
}

function secondOccurrence(): bigint {
  return 1234567890123456789012345678901234567890n;
}

function power(): bigint {
  return 10n ** 30n;
}

console.log("a power of constants:", power(), typeof power(), power() === 1000000000000000000000000000000n);
console.log("two occurrences:", firstOccurrence() === secondOccurrence(), firstOccurrence() === secondOccurrence() + 1n);

function hasSameValueAfterCollections(rounds: number): boolean {
  const first = firstOccurrence();
  let isSame = true;
  for (let i = 0; i < rounds; i++) {
    Bun.gc(true);
    isSame = isSame && firstOccurrence() === first && secondOccurrence() - first === 0n;
  }
  return isSame;
}
console.log("across collections:", hasSameValueAfterCollections(5), firstOccurrence());
