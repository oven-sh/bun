// The same package with one more function, never called, that has a type error.
import { shout } from "typed-package-b";
declare const console: { log(...values: unknown[]): void };
let answer;
try { answer = shout(JSON.parse('"text"')); } catch (error) { answer = (error as Error).name; }
console.log(answer);
