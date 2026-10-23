import { make } from "./cycle-a.ts";
export const keptInB: { tag: string }[] = [];
export function fromB(): string {
  const made = make("made by a for b");
  keptInB.push(made);
  return made.tag + "!";
}
