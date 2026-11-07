type Then = () => void;
export function walkSet(things: Set<number>, atTurn: number, then: Then, leaveAt = -1): string {
  let seen = "", turn = 0;
  for (const thing of things) {
    if (turn === atTurn) then();
    seen += thing + ",";
    if (turn === leaveAt) break;
    turn++;
  }
  return seen;
}
export function walkMap(things: Map<string, number>, atTurn: number, then: Then, leaveAt = -1): string {
  let seen = "", turn = 0;
  for (const [key, value] of things) {
    if (turn === atTurn) then();
    seen += key + "=" + value + ",";
    if (turn === leaveAt) break;
    turn++;
  }
  return seen;
}
export function walkText(things: string, atTurn: number, then: Then, leaveAt = -1): string {
  let seen = "", turn = 0;
  for (const thing of things) {
    if (turn === atTurn) then();
    seen += thing + ",";
    if (turn === leaveAt) break;
    turn++;
  }
  return seen;
}
export function walkAnything(things: any, atTurn: number, then: Then, leaveAt = -1): string {
  let seen = "", turn = 0;
  for (const thing of things) {
    if (turn === atTurn) then();
    seen += String(thing) + ",";
    if (turn === leaveAt) break;
    turn++;
  }
  return seen;
}
export function walkValues(things: Map<string, number>, atTurn: number, then: Then): string {
  let seen = "", turn = 0;
  for (const value of things.values()) {
    if (turn++ === atTurn) then();
    seen += value + ",";
  }
  return seen;
}
export function walkKeys(things: Map<string, number>, atTurn: number, then: Then): string {
  let seen = "", turn = 0;
  for (const key of things.keys()) {
    if (turn++ === atTurn) then();
    seen += key + ",";
  }
  return seen;
}
export function walkEntries(things: Map<string, number>, atTurn: number, then: Then): string {
  let seen = "", turn = 0;
  for (const [key, value] of things.entries()) {
    if (turn++ === atTurn) then();
    seen += key + "=" + value + ",";
  }
  return seen;
}
export function walkValuesOfSet(things: Set<number>, atTurn: number, then: Then): string {
  let seen = "", turn = 0;
  for (const value of things.values()) {
    if (turn++ === atTurn) then();
    seen += value + ",";
  }
  return seen;
}
export function walkEntriesOfList(things: number[], atTurn: number, then: Then): string {
  let seen = "", turn = 0;
  for (const [at, value] of things.entries()) {
    if (turn++ === atTurn) then();
    seen += at + ":" + value + ",";
  }
  return seen;
}
export const spreadSet = (things: Set<number>): string => [0, ...things, 9].join();
export const firstTwo = (things: Set<number>): string => { let seen = ""; for (let round = 0; round < 2; round++) { const [first, second] = things; seen += first + "+" + second + ";"; } return seen; };
export const list = (): number[] => [1, 2, 3, 4];
export const set = (): Set<number> => new Set([1, 2, 3, 4]);
export const map = (): Map<string, number> => new Map([["a", 1], ["b", 2], ["c", 3]]);
export const text = (): string => ["ab", "\u{1F600}c"].join("");
