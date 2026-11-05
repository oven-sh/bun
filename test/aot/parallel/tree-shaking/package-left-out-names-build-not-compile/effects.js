import { first } from "requires-outside";
import { second } from "imports-a-url";
import { third } from "evaluates-a-text";
import { fourth } from "evaluates-a-text-in-a-text";
console.log("effects");
export function unused() {
  return [first, second, third, fourth];
}
