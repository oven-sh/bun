// An empty list without a declared type is born for what is pushed into it also where its function is copied into the caller and the number of pushes is known there.
// Flags: --aot-heat=everything-is-hot
import { jscDescribe } from "bun:jsc";

const enum Flag {
  None = 0,
  First = 1,
  Second = 2,
  Mask = 7,
}

function storageOf(list: readonly unknown[]): string {
  return /ArrayWith[A-Za-z0-9]+/.exec(jscDescribe(list))?.[0] ?? "?";
}

const kept: unknown[] = [];
function keep(list: unknown): void {
  if (kept.length < 3) kept.push(list);
}

function flagsOf(count: number): Flag[] {
  const flags = [];
  for (let i = 0; i < count; i++) flags.push((i & 1 ? Flag.First : 0) | (i & 2 ? Flag.Second : 0));
  keep(flags);
  return flags;
}

function halvesOf(count: number): number[] {
  const halves = [];
  for (let i = 0; i < count; i++) halves.push(i + 0.5);
  keep(halves);
  return halves;
}

function namesOf(count: number): string[] {
  const names = [];
  for (let i = 0; i < count; i++) names.push("n" + i);
  keep(names);
  return names;
}

function mixedOf(count: number): (number | string)[] {
  const mixed = [];
  for (let i = 0; i < count; i++) {
    mixed.push(i);
    if (i & 1) mixed.push("odd");
  }
  keep(mixed);
  return mixed;
}

function countSecond(flags: readonly Flag[]): number {
  let found = 0;
  for (let i = 0; i < flags.length; i++) if ((flags[i] & Flag.Mask) === Flag.Second) found++;
  return found;
}

let found = 0;
let sum = 0;
for (let round = 0; round < 300; round++) {
  found += countSecond(flagsOf(1 + (round & 7)));
  for (const half of halvesOf(round & 3)) sum += half;
}
console.log(found, sum);
console.log(storageOf(flagsOf(4)), storageOf(halvesOf(4)), storageOf(namesOf(4)), storageOf(mixedOf(4)));
console.log(JSON.stringify([flagsOf(5), halvesOf(3), namesOf(2), mixedOf(3), kept.length]));
