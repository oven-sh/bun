import { seen } from "./seen";
import { nameOfSecond } from "./second";

export function nameOfFirst(): string {
  return "first";
}
seen.push("first sees " + nameOfSecond());
throw new Error("thrown by first.ts");
