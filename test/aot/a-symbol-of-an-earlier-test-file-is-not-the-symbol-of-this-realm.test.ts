import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --isolate` gives each test file a fresh realm of one VM, and each realm evaluates the modules anew: `Symbol("mark")` at the top of a module makes one symbol in each realm.
// `Bun.s3` is one object for the VM, so what a file hangs on it is there for the next file, in plain Bun too. A native addon that keeps a reference carries values the same way.
// Every realm runs the same compiled image. A call of Symbol that runs once had one symbol in the image, so both realms got the same one.
const asks = `import { test } from "bun:test";
import * as ours from "./kit.mjs";
import * as mine from "./more.mjs";
test("symbols", () => {
  const theirs = Bun.s3.kept;
  const tell = (label, run) => console.log("SEEN", label, String(run()));
  tell("ours:", () => [ours.read(new ours.Keyed()), ours.has(new ours.Keyed()), ours.read(ours.literal()), ours.read(ours.write({})), new ours.Keyed()[ours.methodKey](), ours.mark.description, ours.bare.description, String(ours.made), Object.getOwnPropertySymbols(new ours.Keyed())[0] === ours.mark]);
  if (theirs !== undefined) {
    tell("is theirs ours:", () => [theirs.mark === ours.mark, theirs.bare === ours.bare, theirs.holder.held === ours.holder.held, theirs.made === ours.made, theirs.inField === ours.inField, theirs.byMethod === ours.byMethod, theirs.Keyed.key === ours.Keyed.key, theirs.Keyed.block === ours.Keyed.block, Object.is(theirs.mark, ours.mark), new Set([theirs.mark, ours.mark]).size]);
    tell("a registered symbol is:", () => [theirs.shared === ours.shared, theirs.shared === Symbol.for("shared")]);
    tell("their key on our objects:", () => [new ours.Keyed()[theirs.mark], ours.literal()[theirs.mark], theirs.mark in new ours.Keyed(), theirs.read(new ours.Keyed()), theirs.has(ours.literal()), typeof new ours.Keyed()[theirs.methodKey]]);
    tell("our key on their objects:", () => [new theirs.Keyed()[ours.mark], theirs.literal()[ours.mark], ours.mark in new theirs.Keyed(), ours.read(new theirs.Keyed()), ours.has(theirs.literal()), typeof new theirs.Keyed()[ours.methodKey]]);
    tell("their key on their objects:", () => [new theirs.Keyed()[theirs.mark], theirs.read(theirs.literal()), theirs.has(new theirs.Keyed()), new theirs.Keyed()[theirs.methodKey]()]);
    tell("both keys on one object:", () => { const x = theirs.write(ours.write({})); return [Object.getOwnPropertySymbols(x).length, x[ours.mark], x[theirs.mark]]; });
    tell("own symbols:", () => [Object.getOwnPropertySymbols(new theirs.Keyed())[0] === theirs.mark, Object.getOwnPropertySymbols(new theirs.Keyed())[0] === ours.mark, Reflect.ownKeys(theirs.literal())[0] === ours.mark]);
    tell("in a switch and a map:", () => { let hit; switch (theirs.mark) { case ours.mark: hit = "ours"; break; default: hit = "other"; } return [hit, new Map([[ours.mark, 1]]).get(theirs.mark), new Map([[ours.mark, 1]]).get(ours.mark)]; });
  }
  Bun.s3.kept = ours;
});
test("what is done with them", () => {
  const theirs = Bun.s3.keptMore;
  const tell = (label, run) => { let said; try { said = String(run()); } catch (error) { said = "throws " + error.name; } console.log("SEEN", label, said); };
  const names = x => Object.getOwnPropertySymbols(x).map(s => (s === mine.mark ? "ours" : theirs && s === theirs.mark ? "theirs" : "other")).join("+");
  tell("00", () => [names(new mine.Keyed()), names(mine.literal()), names({ ...new mine.Keyed() }), names(Object.assign({}, mine.literal())), mine.rest(mine.literal())]);
  if (theirs !== undefined) {
    for (const [label, make] of [["10", () => new theirs.Keyed()], ["20", () => theirs.literal()]]) {
      tell(label + " names", () => [names(make()), Reflect.ownKeys(make()).length, names({ ...make() }), names(Object.assign({}, make())), names(mine.spread(make())), names(theirs.spread(make())), names(Object.assign(new mine.Keyed(), make())), names(Object.assign(make(), new mine.Keyed()))]);
      tell(label + " reads", () => [mine.read(make()), theirs.read(make()), mine.owns(make()), theirs.owns(make()), mine.describe(make()), theirs.describe(make()), mine.rest(make()), theirs.rest(make())]);
      tell(label + " stores", () => { const x = mine.write(make(), 7); return [names(x), x[mine.mark], x[theirs.mark], mine.read(x), theirs.read(x)]; });
      tell(label + " defines", () => { const x = mine.define(make(), 8); return [names(x), x[mine.mark], x[theirs.mark]]; });
      tell(label + " deletes", () => { const x = make(); return [mine.remove(x), names(x), theirs.remove(x), names(x)]; });
      tell(label + " copies", () => { const x = structuredClone({ plain: make().plain }); return [x.plain, JSON.stringify(make()), Object.keys(make()), Object.entries(make())]; });
    }
    for (const [label, make] of [["30", () => new mine.Keyed()], ["40", () => mine.literal()]]) {
      tell(label + " names", () => [names(make()), names(theirs.spread(make())), names(Object.assign(new theirs.Keyed(), make()))]);
      tell(label + " reads", () => [theirs.read(make()), theirs.owns(make()), theirs.describe(make()), theirs.rest(make())]);
      tell(label + " stores", () => { const x = theirs.write(make(), 7); return [names(x), x[mine.mark], x[theirs.mark], mine.read(x), theirs.read(x)]; });
      tell(label + " defines", () => { const x = theirs.define(make(), 8); return [names(x), x[mine.mark], x[theirs.mark]]; });
      tell(label + " deletes", () => { const x = make(); return [theirs.remove(x), names(x), mine.remove(x), names(x)]; });
    }
  }
  tell("50 a snapshot of the heap", () => { const held = mine.write({}, { inner: 1 }); return [typeof Bun.generateHeapSnapshot(), new mine.Holder()[mine.mark].inner, held[mine.mark].inner]; });
  Bun.s3.keptMore = mine;
});
`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "kit.mjs": `export const mark = Symbol("mark");
export const bare = Symbol();
export const shared = Symbol.for("shared");
export const holder = { held: Symbol("held") };
function once() { return Symbol("in a function"); }
export const made = once();
class Maker { field = Symbol("in a field"); make() { return Symbol("in a method"); } }
const maker = new Maker();
export const inField = maker.field;
export const byMethod = maker.make();
export const methodKey = Symbol("method");
export class Keyed { static key = Symbol("static"); static block; static { Keyed.block = Symbol("in a static block"); } [mark] = 1; [methodKey]() { return 2; } }
export const read = x => x[mark];
export const has = x => mark in x;
export const write = x => { x[mark] = 3; return x; };
export const literal = () => ({ [mark]: 4 });
`,
  "more.mjs": `export const mark = Symbol("mark");
export class Keyed { [mark] = 1; plain = 2; }
export const literal = () => ({ [mark]: 4, plain: 5 });
export class Holder { [mark] = { inner: 2 }; }
export const read = x => x[mark];
export const write = (x, v) => { x[mark] = v; return x; };
export const remove = x => delete x[mark];
export const owns = x => Object.hasOwn(x, mark);
export const spread = x => ({ ...x });
export const rest = x => { const { [mark]: taken, ...others } = x; return [taken, Object.getOwnPropertySymbols(others).length]; };
export const describe = x => Object.getOwnPropertyDescriptor(x, mark)?.value;
export const define = (x, v) => Object.defineProperty(x, mark, { value: v, enumerable: true, writable: true, configurable: true });
`,
  "a.test.mjs": asks,
  "b.test.mjs": asks,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const command = [bunExe(), "test", "--isolate", ...flags, "./a.test.mjs", "./b.test.mjs"];
  const { stdout, stderr, exitCode } = await run(command, directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [way, words] of [
  ["as the runner divides it", undefined],
  ["as one program", "TestRunLayers:0"],
  ["over two layers, both files in one process", "TestRunLayers:2,TestRunPartFiles:3"],
] as const) {
  test(`a symbol of an earlier test file is not the symbol of this realm, ${way}`, async () => {
    using dir = tempDir("aot-a-symbol-of-an-earlier-test-file", files);
    const plain = await runTests(String(dir), undefined);
    const ours = "SEEN ours: 1,true,4,3,2,mark,,Symbol(in a function),true";
    expect(plain).toEqual({
      stdout: [
        ours,
        "SEEN 00 ours,ours,ours,ours,4,0",
        "SEEN 50 a snapshot of the heap object,2,1",
        ours,
        "SEEN is theirs ours: false,false,false,false,false,false,false,false,false,2",
        "SEEN a registered symbol is: true,true",
        "SEEN their key on our objects: ,,false,,false,undefined",
        "SEEN our key on their objects: ,,false,,false,undefined",
        "SEEN their key on their objects: 1,4,true,2",
        "SEEN both keys on one object: 2,3,3",
        "SEEN own symbols: true,false,false",
        "SEEN in a switch and a map: other,,1",
        "SEEN 00 ours,ours,ours,ours,4,0",
        "SEEN 10 names theirs,2,theirs,theirs,theirs,theirs,ours+theirs,theirs+ours",
        "SEEN 10 reads ,1,false,true,,1,,1,1,0",
        "SEEN 10 stores theirs+ours,7,1,7,1",
        "SEEN 10 defines theirs+ours,8,1",
        "SEEN 10 deletes true,theirs,true,",
        'SEEN 10 copies 2,{"plain":2},plain,plain,2',
        "SEEN 20 names theirs,2,theirs,theirs,theirs,theirs,ours+theirs,theirs+ours",
        "SEEN 20 reads ,4,false,true,,4,,1,4,0",
        "SEEN 20 stores theirs+ours,7,4,7,4",
        "SEEN 20 defines theirs+ours,8,4",
        "SEEN 20 deletes true,theirs,true,",
        'SEEN 20 copies 5,{"plain":5},plain,plain,5',
        "SEEN 30 names ours,ours,theirs+ours",
        "SEEN 30 reads ,false,,,1",
        "SEEN 30 stores ours+theirs,1,7,1,7",
        "SEEN 30 defines ours+theirs,1,8",
        "SEEN 30 deletes true,ours,true,",
        "SEEN 40 names ours,ours,theirs+ours",
        "SEEN 40 reads ,false,,,1",
        "SEEN 40 stores ours+theirs,4,7,4,7",
        "SEEN 40 defines ours+theirs,4,8",
        "SEEN 40 deletes true,ours,true,",
        "SEEN 50 a snapshot of the heap object,2,1",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
