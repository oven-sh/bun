import { seen } from "./seen";
import { nameOfA } from "./cycle-a";
seen.push("cycle b sees " + nameOfA());
export function nameOfB(): string {
  return "b";
}
throw new Error("thrown by cycle-b.ts");
