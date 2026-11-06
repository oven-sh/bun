enum Mode {
  Slow,
  Fast = 4,
  Named = "named",
}
const mode = Mode.Fast;
export const named = Mode.Named;
const flags = Mode.Slow | Mode.Fast | 1;
const copy = mode;
const label = `${named}:${copy}`;
const size = "abc".length;
const letter = named[0];
const item = ["a", "b"][Mode.Slow];
const joined = Mode.Named + "!";
import { readAll } from "./second.ts";
export function readMode() {
  return mode;
}
export function readNamed() {
  return named;
}
export function readFlags() {
  return flags;
}
export function readCopy() {
  return copy;
}
export function readLabel() {
  return label;
}
export function readSize() {
  return size;
}
export function readLetter() {
  return letter;
}
export function readItem() {
  return item;
}
export function readJoined() {
  return joined;
}
console.log("first", readAll());
