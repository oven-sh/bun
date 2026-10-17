// A closure made in one iteration of a loop keeps that iteration's variables. What an initializer does because of them (an effect, a read of a variable that changes, a throw) happens where the constant is declared.
import { log } from "./log";
import { byArrow, byDeclaration, byLet, readsStep, setStep } from "./made";
log.push("loaded");
setStep(10);
console.log(JSON.stringify([byArrow, byDeclaration, byLet, readsStep]), log.join());
let loaded = false;
try {
  const throws = await import("./throws");
  loaded = true;
  console.log(JSON.stringify(throws.thrown));
} catch (error) {
  console.log(loaded ? "when it was read:" : "while it was loaded:", (error as Error).name);
}
