// @ts-nocheck
export enum Kind {
  Length = "text".length,
  Next,
}
export enum Odd {
  NaN = "a".length,
  X = 0 / 0,
  Infinity = "ab".length,
  Big = 1 / 0,
}
export function ownReads() {
  return [Kind.Length, Kind.Next, Odd.NaN, Odd.Infinity];
}
export function spoil() {
  const all: any = Kind;
  all.Length = 9;
}
