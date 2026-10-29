import { one } from "deep/one";
import { two } from "two.mjs";
export function all(): string {
  return one() + two();
}
