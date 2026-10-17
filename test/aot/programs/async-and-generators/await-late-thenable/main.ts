// What comes of awaiting an object is what its `then` resolves with, also where the type of the object has no `then`: an heir may have one, in a file with types or without, and so may the object itself.
import { Core } from "./core.ts";
import { addThen, Heir, HeirThatRejects, HeirThatYieldsACore } from "./heir.js";

class TypedHeir extends Core {
  then(resolve: (value: string) => void) {
    resolve("from a typed heir");
  }
}
interface Plain {
  n: number;
}
const show = (label: string, got: unknown) => console.log(label + ":", typeof got, typeof got === "object" && got !== null ? (got as Core).n : String(got));

const core: Core = new Heir();
const atTheTop = await core;
show("at the top level", atTheTop);

async function inAFunction(given: Core) {
  return await given;
}
show("in an async function", await inAFunction(new Heir()));
show("in an async function, without a then", await inAFunction(new Core()));

await Promise.resolve(core).then(got => show("by Promise.resolve", got));
await Promise.resolve(new Core() as Core).then(got => show("by Promise.resolve, without a then", got));
show("by Promise.all", (await Promise.all([new Heir() as Core]))[0]);

const typed: Core = new TypedHeir();
show("an heir with types", await typed);

const more = {
  n: 1,
  then(resolve: (value: string) => void) {
    resolve("from a literal");
  },
};
const plain: Plain = more;
show("an object literal under a narrower type", await plain);

const own: Core = addThen(new Core());
show("a then of its own", await own);

const yieldsACore: Core = new HeirThatYieldsACore();
const yielded = await yieldsACore;
show("a then that resolves with what the type says", yielded);
console.log("and it is used as that:", yielded.n + 1, yielded instanceof HeirThatYieldsACore);

const rejects: Core = new HeirThatRejects();
try {
  show("not reached", await rejects);
} catch (error) {
  console.log("a then that rejects:", (error as Error).message);
}

const cores: Core[] = [new Core(), new Heir(), new Core(), new TypedHeir()];
for (const one of cores) {
  const got = await one;
  show("one after the other", got);
  if (typeof got === "object") console.log("  its field:", got.n + 1);
}

const either: (Core | Promise<Core>)[] = [new Core(), Promise.resolve(new Core()), new Heir()];
for (const one of either) show("an object or a promise of one", await one);

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const got = await (i % 500 === 499 ? core : cores[0]);
  sum += typeof got === "object" ? got.n : String(got).length;
}
console.log("in a loop:", sum);
