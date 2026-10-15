import { seen } from "./seen";
import { nameOfB } from "./cycle-b";
seen.push("cycle a");
export function nameOfA(): string {
  return "a";
}
export const both = nameOfA() + nameOfB();
