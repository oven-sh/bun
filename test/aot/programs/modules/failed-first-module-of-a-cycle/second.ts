import { seen } from "./seen";
import { nameOfFirst } from "./first";
import { outside } from "./outside";

export function nameOfSecond(): string {
  return "second";
}
seen.push("second sees " + nameOfFirst() + " and " + outside);
