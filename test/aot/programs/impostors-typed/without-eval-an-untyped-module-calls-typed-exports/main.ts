import { honestElsewhere } from "./honest-caller.ts";
import code, { halved, insideTheLibrary, Scale, sum, total } from "./library.ts";
import { attempt, log } from "./print.ts";
import { untypedCalls } from "./untyped-caller.js";

function honest(label: string): void {
  console.log(label, total([1, 2]), sum({ x: 1, y: 2 }), code("a"), halved(3), new Scale(2).apply(3), insideTheLibrary(), honestElsewhere(2));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += honestElsewhere(i) + total([i]) + halved(i);
console.log("2000 honest rounds", warm);

const calls = untypedCalls(log);
for (const [name, call] of Object.entries(calls)) attempt(name, call);
for (const [name, call] of Object.entries(calls)) attempt("again: " + name, call);

honest("honest after");
