// The generators of a generator function of the library hang below what `prototype` answers on that function at each call: it has none of its own, so the member of %AsyncGeneratorFunction.prototype% answers.
// Each of the three ways to change that answer is taken after the function has been called often, and undone again.
import { glob } from "node:fs/promises";
const asyncGeneratorFunctionPrototype = Object.getPrototypeOf(async function* () {});
const asyncGeneratorPrototype = asyncGeneratorFunctionPrototype.prototype;
const names = new Map<unknown, string>([[asyncGeneratorPrototype, "the realm's"]]);
const log: string[] = [];
function above(label: string) {
  let answer = "";
  for (let turn = 0; turn < 50; turn++) {
    const generator = glob("nothing-*.none");
    const now = names.get(Object.getPrototypeOf(generator)) ?? "another";
    if (now !== answer) answer += (answer ? " then " : "") + now;
  }
  log.push(label + ": " + answer);
}
function attempt(label: string, change: () => void) {
  try {
    change();
    log.push(label + " done");
  } catch (error) {
    log.push(label + " threw " + (error as Error).constructor.name);
  }
}

above("as made");

const own = { marker: "own" };
names.set(own, "its own");
attempt("own prototype", () => Object.defineProperty(glob, "prototype", { value: own, configurable: true, writable: true }));
above("with its own");
attempt("own prototype stored", () => ((glob as any).prototype = asyncGeneratorPrototype));
above("with the realm's stored as its own");
attempt("own prototype is no object", () => ((glob as any).prototype = 5));
above("with a number as its own");
attempt("own prototype deleted", () => delete (glob as any).prototype);
above("as made again");

const parent = Object.create(asyncGeneratorFunctionPrototype, { prototype: { value: { marker: "of the parent" }, configurable: true } });
names.set(parent.prototype, "the new parent's");
attempt("another parent", () => Object.setPrototypeOf(glob, parent));
above("below another parent");
attempt("the first parent", () => Object.setPrototypeOf(glob, asyncGeneratorFunctionPrototype));
above("below the first parent");

// An executable does not let the member above be replaced; plain Bun does. Either way the generators hang below what it answers now.
function belowWhatTheMemberAnswers(label: string) {
  let held = 0;
  for (let turn = 0; turn < 50; turn++) held += Number(Object.getPrototypeOf(glob("nothing-*.none")) === (asyncGeneratorFunctionPrototype.prototype ?? asyncGeneratorPrototype));
  log.push(label + ": " + held);
}
function quietly(change: () => void) {
  try {
    change();
  } catch {}
}
const replaced = Object.create(asyncGeneratorPrototype, { marker: { value: "replaced" } });
quietly(() => Object.defineProperty(asyncGeneratorFunctionPrototype, "prototype", { value: replaced }));
belowWhatTheMemberAnswers("with the member above replaced");
async function* ofTheProgram() {}
log.push("a program's own: " + (Object.getPrototypeOf(Object.getPrototypeOf(ofTheProgram())) === asyncGeneratorPrototype));
quietly(() => Object.defineProperty(asyncGeneratorFunctionPrototype, "prototype", { value: asyncGeneratorPrototype }));
belowWhatTheMemberAnswers("with the member above put back");
quietly(() => delete asyncGeneratorFunctionPrototype.prototype);
belowWhatTheMemberAnswers("with the member above deleted");
console.log(log.join("\n"));
