type Then = () => void;
export const list = (): number[] => [1, 2, 3, 4];
export function walkList(things: number[], atTurn: number, then: Then, leaveAt = -1): string {
  let seen = "", turn = 0;
  for (const thing of things) {
    if (turn === atTurn) then();
    seen += thing + ",";
    if (turn === leaveAt) break;
    turn++;
  }
  return seen;
}
export function walkAnything(things: any, atTurn: number, then: Then): string {
  let seen = "", turn = 0;
  for (const thing of things) {
    if (turn++ === atTurn) then();
    seen += String(thing) + ",";
  }
  return seen;
}
export class Holder {
  private things: number[] = [];
  add(thing: number): void { this.things.push(thing); }
  walk(): string { let seen = ""; for (const thing of this.things) seen += thing + ","; return seen; }
  lay(name: string | symbol, value: unknown): void { (this.things as any)[name] = value; }
}
export function spreadList(things: number[]): string { return [0, ...things, 9].join(","); }
export function firstTwo(things: number[]): string { const [first, second] = things; return first + "," + second; }
export function firstAndRest(things: number[]): string { const [first, ...rest] = things; return first + "|" + rest.join(","); }
export function walkValues(things: number[]): string { let seen = ""; for (const thing of things.values()) seen += thing + ","; return seen; }
export function walkKeys(things: number[]): string { let seen = ""; for (const at of things.keys()) seen += at + ","; return seen; }
export function walkEntries(things: number[]): string { let seen = ""; for (const [at, thing] of things.entries()) seen += at + "=" + thing + ","; return seen; }
export function handOn(...things: number[]): string { return things.join(","); }
export function spreadIntoCall(things: number[]): string { return handOn(...things); }
