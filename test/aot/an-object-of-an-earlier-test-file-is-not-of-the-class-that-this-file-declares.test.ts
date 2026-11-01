import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

// `bun test --isolate` gives each test file a fresh realm of one VM, and each realm runs an instance of the compiled program of its own.
// `Bun.s3` is one object for the VM, so what a file hangs on it is there for the next file, in plain Bun too.
// The objects of every instance have the same shapes. A test of a declared type asked for the shape alone, so an object of the earlier file passed for
// an object of this file's class: its methods ran with this file's variables, and this file's private names were read off it.
// A store into a field of a declared type asked the same way, in a stub, in the run time and in the cache of kinds that a type has accepted.
const asks = `import { test } from "bun:test";
import * as ours from "./kit";
test("asks", () => {
  const theirs = (Bun.s3 as any).keptTyped as typeof ours | undefined;
  const side = (f: unknown): string => (f === ours.Fault ? "ours" : f === theirs!.Fault ? "theirs" : f instanceof ours.Fault ? "an instance of ours" : f instanceof theirs!.Fault ? "an instance of theirs" : f instanceof TypeError ? "a TypeError" : String(f));
  const tell = (label: string, run: () => unknown) => { let said; try { said = "returns " + side(run()); } catch (e) { said = "throws " + side(e); } console.log("SEEN", label, said); };
  const counted = (run: () => unknown) => { const before = [theirs!.readCount(), ours.readCount()]; run(); return [theirs!.readCount() - before[0], ours.readCount() - before[1]].join(); };
  if (theirs !== undefined) {
    for (const [where, get] of [["kept", () => theirs.kept], ["fresh", () => new theirs.Holder()], ["made there", () => theirs.make()], ["below", () => new theirs.Below()]] as const) {
      tell(where + ", a method:", () => ours.askMethod(get()));
      tell(where + ", one that counts:", () => counted(() => ours.askBump(get())));
      tell(where + ", one that throws:", () => ours.askFail(get()));
      tell(where + ", an arrow in a field:", () => ours.askArrow(get()));
      tell(where + ", a getter:", () => ours.askGetter(get()));
      tell(where + ", a setter:", () => counted(() => ours.askSetter(get())));
      tell(where + ", read then called:", () => ours.askRead(get()));
      tell(where + ", by an interface:", () => ours.askInterface(get()));
      tell(where + ", by a union:", () => ours.askUnion(get()));
      tell(where + ", in a list:", () => ours.askList([get()]));
      tell(where + ", in a field:", () => ours.askField({ held: get() }));
      tell(where + ", a declared function:", () => ours.askDeclared(get()));
      tell(where + ", a method that asks:", () => new ours.Asker().ask(get()));
      tell(where + ", a field that asks:", () => new ours.Asker().asks(get()));
      tell(where + ", by a cast:", () => ours.askCast(get()));
      tell(where + ", by a declared variable:", () => ours.askVariable(get()));
      tell(where + ", each of a list:", () => ours.askEach([get()]));
      tell(where + ", a rest parameter:", () => ours.askRest(get()));
      tell(where + ", a default:", () => ours.askDefault(get()));
      tell(where + ", destructured:", () => ours.askDestructured({ held: get() }));
      tell(where + ", optional:", () => ours.askOptional(get()));
      tell(where + ", by a declared result:", () => ours.askReturned(get()));
      tell(where + ", in a field of a class:", () => new ours.Box(get()).ask());
      tell(where + ", stored by name:", () => ours.putNamed(new ours.Box(new ours.Holder()), get()));
      tell(where + ", stored by name from here:", () => { const b = new ours.Box(new ours.Holder()); (b as any).held = get(); return b.ask(); });
      tell(where + ", stored by a computed key:", () => ours.putKeyed(new ours.Box(new ours.Holder()), "he" + "ld".slice(0), get()));
      tell(where + ", stored by a computed key, warm:", () => { const key = "he" + "ld".slice(0); for (let i = 0; i < 400; i++) ours.putKeyed(new ours.Box(new ours.Holder()), key, new ours.Holder()); return ours.putKeyed(new ours.Box(new ours.Holder()), key, get()); });
      tell(where + ", its arrow stored:", () => ours.putArrow(new ours.Holder(), get().arrow));
      tell(where + ", its arrow stored by a computed key, warm:", () => { const key = "arr" + "ow".slice(0); for (let i = 0; i < 400; i++) ours.putArrowKeyed(new ours.Holder(), key, new ours.Holder().arrow); return ours.putArrowKeyed(new ours.Holder(), key, get().arrow); });
      tell(where + ", assigned from a box of theirs:", () => ours.assignBox(new ours.Box(new ours.Holder()), new theirs.Box(get())));
      tell(where + ", spread from a box of theirs:", () => ours.spreadBox(new theirs.Box(get())));
      tell(where + ", behind instanceof:", () => ours.askGuarded(get()));
      tell(where + ", a private name:", () => ours.Holder.secretOf(get()));
      tell(where + ", a private name, in:", () => ours.Holder.has(get()));
      tell(where + ", their private name:", () => theirs.Holder.secretOf(get()));
    }
    tell("below Error, kept:", () => ours.askBranded(theirs.keptFault));
    tell("below Error, fresh:", () => ours.askBranded(new theirs.Fault("fresh")));
    tell("hot with ours, then theirs:", () => { let n = 0; for (let i = 0; i < 3000; i++) n += ours.askMethod(new ours.Holder()) === ours.Fault ? 0 : 1000; return [n, side(ours.askMethod(new theirs.Holder())), side(ours.askMethod(theirs.kept))].join(); });
    tell("either in a loop:", () => { let n = 0; for (let i = 0; i < 3000; i++) n += ours.askMethod(new (i & 1 ? theirs : ours).Holder()) === (i & 1 ? theirs : ours).Fault ? 1 : 1000; return n; });
    tell("ours:", () => ours.askMethod(new ours.Holder()));
  }
  (Bun.s3 as any).keptTyped = ours;
});
`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "kit.ts": `export class Fault extends Error { name = "Fault"; which() { return Fault; } }
export let count = 0;
export class Holder {
  tag = "holder";
  #secret = 7;
  arrow = () => Fault;
  method() { return Fault; }
  bump() { return ++count; }
  fail(): never { throw new Fault("in a method"); }
  get got() { return Fault; }
  set put(step: number) { count += step; }
  static secretOf(h: Holder) { return h.#secret; }
  static has(h: Holder) { return #secret in h; }
}
export class Below extends Holder {}
export interface Asked { method(): unknown; }
export const askMethod = (h: Holder) => h.method();
export const askBump = (h: Holder) => h.bump();
export const askFail = (h: Holder) => h.fail();
export const askArrow = (h: Holder) => h.arrow();
export const askGetter = (h: Holder) => h.got;
export const askSetter = (h: Holder) => { h.put = 5; };
export const askRead = (h: Holder) => { const f = h.method; return f(); };
export const askInterface = (h: Asked) => h.method();
export const askUnion = (h: Holder | null) => (h === null ? undefined : h.method());
export const askList = (list: Holder[]) => list[0].method();
export const askField = (box: { held: Holder }) => box.held.method();
export function askDeclared(h: Holder) { return h.method(); }
export class Asker { ask(h: Holder) { return h.method(); } asks = (h: Holder) => h.method(); }
export const askCast = (x: unknown) => (x as Holder).method();
export const askVariable = (x: any) => { const h: Holder = x; return h.method(); };
export const askEach = (list: Holder[]) => { for (const h of list) return h.method(); };
export const askRest = (...list: Holder[]) => list[0].method();
export const askDefault = (x: any, h: Holder = x) => h.method();
export const askDestructured = ({ held }: { held: Holder }) => held.method();
export const askOptional = (h?: Holder) => h?.method();
export const askReturned = (x: any) => ((): Holder => x)().method();
export const askBranded = (e: Fault) => e.which();
export class Box { held: Holder; constructor(h: Holder) { this.held = h; } ask() { return this.held.method(); } }
export const putNamed = (b: Box, x: any) => { (b as any).held = x; return b.ask(); };
export const putKeyed = (b: Box, key: string, x: any) => { (b as any)[key] = x; return b.ask(); };
export const putArrow = (h: Holder, f: any) => { (h as any).arrow = f; return h.arrow(); };
export const putArrowKeyed = (h: Holder, key: string, f: any) => { (h as any)[key] = f; return h.arrow(); };
export const assignBox = (b: Box, from: any) => Object.assign(b, from).ask();
export const spreadBox = (from: any) => { const copy: { held: Holder } = { ...from }; return copy.held.method(); };
export function askGuarded(x: unknown) { return x instanceof Holder ? x.method() : "no Holder of this file"; }
export const kept = new Holder();
export const keptFault = new Fault("kept");
export const make = () => new Holder();
export const readCount = () => count;
`,
  "a.test.ts": asks,
  "b.test.ts": asks,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const command = [bunExe(), "test", "--isolate", ...flags, "./a.test.ts", "./b.test.ts"];
  const { stdout, stderr, exitCode } = await run(command, directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [way, words] of [
  ["as the runner divides it", undefined],
  ["as one program", "TestRunLayers:0"],
  ["over two layers, both files in one process", "TestRunLayers:2,TestRunPartFiles:3"],
] as const) {
  test(`an object of an earlier test file is not of the class that this file declares, ${way}`, async () => {
    using dir = tempDir("aot-an-object-of-an-earlier-test-file-is-not-of-the-class", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: [
        "SEEN kept, a method: returns theirs",
        "SEEN kept, one that counts: returns 1,0",
        "SEEN kept, one that throws: throws an instance of theirs",
        "SEEN kept, an arrow in a field: returns theirs",
        "SEEN kept, a getter: returns theirs",
        "SEEN kept, a setter: returns 5,0",
        "SEEN kept, read then called: returns theirs",
        "SEEN kept, by an interface: returns theirs",
        "SEEN kept, by a union: returns theirs",
        "SEEN kept, in a list: returns theirs",
        "SEEN kept, in a field: returns theirs",
        "SEEN kept, a declared function: returns theirs",
        "SEEN kept, a method that asks: returns theirs",
        "SEEN kept, a field that asks: returns theirs",
        "SEEN kept, by a cast: returns theirs",
        "SEEN kept, by a declared variable: returns theirs",
        "SEEN kept, each of a list: returns theirs",
        "SEEN kept, a rest parameter: returns theirs",
        "SEEN kept, a default: returns theirs",
        "SEEN kept, destructured: returns theirs",
        "SEEN kept, optional: returns theirs",
        "SEEN kept, by a declared result: returns theirs",
        "SEEN kept, in a field of a class: returns theirs",
        "SEEN kept, stored by name: returns theirs",
        "SEEN kept, stored by name from here: returns theirs",
        "SEEN kept, stored by a computed key: returns theirs",
        "SEEN kept, stored by a computed key, warm: returns theirs",
        "SEEN kept, its arrow stored: returns theirs",
        "SEEN kept, its arrow stored by a computed key, warm: returns theirs",
        "SEEN kept, assigned from a box of theirs: returns theirs",
        "SEEN kept, spread from a box of theirs: returns theirs",
        "SEEN kept, behind instanceof: returns no Holder of this file",
        "SEEN kept, a private name: throws a TypeError",
        "SEEN kept, a private name, in: returns false",
        "SEEN kept, their private name: returns 7",
        "SEEN fresh, a method: returns theirs",
        "SEEN fresh, one that counts: returns 1,0",
        "SEEN fresh, one that throws: throws an instance of theirs",
        "SEEN fresh, an arrow in a field: returns theirs",
        "SEEN fresh, a getter: returns theirs",
        "SEEN fresh, a setter: returns 5,0",
        "SEEN fresh, read then called: returns theirs",
        "SEEN fresh, by an interface: returns theirs",
        "SEEN fresh, by a union: returns theirs",
        "SEEN fresh, in a list: returns theirs",
        "SEEN fresh, in a field: returns theirs",
        "SEEN fresh, a declared function: returns theirs",
        "SEEN fresh, a method that asks: returns theirs",
        "SEEN fresh, a field that asks: returns theirs",
        "SEEN fresh, by a cast: returns theirs",
        "SEEN fresh, by a declared variable: returns theirs",
        "SEEN fresh, each of a list: returns theirs",
        "SEEN fresh, a rest parameter: returns theirs",
        "SEEN fresh, a default: returns theirs",
        "SEEN fresh, destructured: returns theirs",
        "SEEN fresh, optional: returns theirs",
        "SEEN fresh, by a declared result: returns theirs",
        "SEEN fresh, in a field of a class: returns theirs",
        "SEEN fresh, stored by name: returns theirs",
        "SEEN fresh, stored by name from here: returns theirs",
        "SEEN fresh, stored by a computed key: returns theirs",
        "SEEN fresh, stored by a computed key, warm: returns theirs",
        "SEEN fresh, its arrow stored: returns theirs",
        "SEEN fresh, its arrow stored by a computed key, warm: returns theirs",
        "SEEN fresh, assigned from a box of theirs: returns theirs",
        "SEEN fresh, spread from a box of theirs: returns theirs",
        "SEEN fresh, behind instanceof: returns no Holder of this file",
        "SEEN fresh, a private name: throws a TypeError",
        "SEEN fresh, a private name, in: returns false",
        "SEEN fresh, their private name: returns 7",
        "SEEN made there, a method: returns theirs",
        "SEEN made there, one that counts: returns 1,0",
        "SEEN made there, one that throws: throws an instance of theirs",
        "SEEN made there, an arrow in a field: returns theirs",
        "SEEN made there, a getter: returns theirs",
        "SEEN made there, a setter: returns 5,0",
        "SEEN made there, read then called: returns theirs",
        "SEEN made there, by an interface: returns theirs",
        "SEEN made there, by a union: returns theirs",
        "SEEN made there, in a list: returns theirs",
        "SEEN made there, in a field: returns theirs",
        "SEEN made there, a declared function: returns theirs",
        "SEEN made there, a method that asks: returns theirs",
        "SEEN made there, a field that asks: returns theirs",
        "SEEN made there, by a cast: returns theirs",
        "SEEN made there, by a declared variable: returns theirs",
        "SEEN made there, each of a list: returns theirs",
        "SEEN made there, a rest parameter: returns theirs",
        "SEEN made there, a default: returns theirs",
        "SEEN made there, destructured: returns theirs",
        "SEEN made there, optional: returns theirs",
        "SEEN made there, by a declared result: returns theirs",
        "SEEN made there, in a field of a class: returns theirs",
        "SEEN made there, stored by name: returns theirs",
        "SEEN made there, stored by name from here: returns theirs",
        "SEEN made there, stored by a computed key: returns theirs",
        "SEEN made there, stored by a computed key, warm: returns theirs",
        "SEEN made there, its arrow stored: returns theirs",
        "SEEN made there, its arrow stored by a computed key, warm: returns theirs",
        "SEEN made there, assigned from a box of theirs: returns theirs",
        "SEEN made there, spread from a box of theirs: returns theirs",
        "SEEN made there, behind instanceof: returns no Holder of this file",
        "SEEN made there, a private name: throws a TypeError",
        "SEEN made there, a private name, in: returns false",
        "SEEN made there, their private name: returns 7",
        "SEEN below, a method: returns theirs",
        "SEEN below, one that counts: returns 1,0",
        "SEEN below, one that throws: throws an instance of theirs",
        "SEEN below, an arrow in a field: returns theirs",
        "SEEN below, a getter: returns theirs",
        "SEEN below, a setter: returns 5,0",
        "SEEN below, read then called: returns theirs",
        "SEEN below, by an interface: returns theirs",
        "SEEN below, by a union: returns theirs",
        "SEEN below, in a list: returns theirs",
        "SEEN below, in a field: returns theirs",
        "SEEN below, a declared function: returns theirs",
        "SEEN below, a method that asks: returns theirs",
        "SEEN below, a field that asks: returns theirs",
        "SEEN below, by a cast: returns theirs",
        "SEEN below, by a declared variable: returns theirs",
        "SEEN below, each of a list: returns theirs",
        "SEEN below, a rest parameter: returns theirs",
        "SEEN below, a default: returns theirs",
        "SEEN below, destructured: returns theirs",
        "SEEN below, optional: returns theirs",
        "SEEN below, by a declared result: returns theirs",
        "SEEN below, in a field of a class: returns theirs",
        "SEEN below, stored by name: returns theirs",
        "SEEN below, stored by name from here: returns theirs",
        "SEEN below, stored by a computed key: returns theirs",
        "SEEN below, stored by a computed key, warm: returns theirs",
        "SEEN below, its arrow stored: returns theirs",
        "SEEN below, its arrow stored by a computed key, warm: returns theirs",
        "SEEN below, assigned from a box of theirs: returns theirs",
        "SEEN below, spread from a box of theirs: returns theirs",
        "SEEN below, behind instanceof: returns no Holder of this file",
        "SEEN below, a private name: throws a TypeError",
        "SEEN below, a private name, in: returns false",
        "SEEN below, their private name: returns 7",
        "SEEN below Error, kept: returns theirs",
        "SEEN below Error, fresh: returns theirs",
        "SEEN hot with ours, then theirs: returns 0,theirs,theirs",
        "SEEN either in a loop: returns 3000",
        "SEEN ours: returns ours",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  });
}
