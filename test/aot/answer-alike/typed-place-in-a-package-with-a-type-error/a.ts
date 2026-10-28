// A text reaches a parameter that a function of a package declares as a number.
import { shout } from "typed-package-a";
declare const console: { log(...values: unknown[]): void };
let answer;
try { answer = shout(JSON.parse('"text"')); } catch (error) { answer = (error as Error).name; }
console.log(answer);
