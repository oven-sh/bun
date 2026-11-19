// A class answers as under plain Bun however it is made: once in a file, again and again in a function or a loop, once in a function with what it captures,
// with a parent that is a class of the program, a built-in, null or nothing that can be one, or without a parent.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `
  class Plain {
    readonly width: number;
    constructor(width: number) { this.width = width; }
    twice(): number { return this.width * 2; }
    static made = 0;
    static make(width: number): Plain { Plain.made++; return new Plain(width); }
  }
  class Failure extends Error {
    readonly line: number;
    constructor(line: number, reason: string) { super("at " + line + ": " + reason); this.name = "Failure"; this.line = line; }
  }
  class Wider extends Plain {
    constructor(width: number) { super(width + 1); }
    override twice(): number { return super.twice() + 1; }
  }
  class WithoutConstructor { size(): number { return 3; } }
  class HeirWithoutConstructor extends Plain {}
  function makeAgain() { return class Again { answer(): number { return 4; } }; }
  function makeAgainUnder(parent: typeof Plain) { return class Under extends parent { thrice(): number { return this.width * 3; } }; }
  function makeCapturing(step: number) { return class Capturing { constructor(public held: number) { this.held += step; } }; }
  const said: unknown[] = [];
  const describe = (made: Function) => [made.name, made.length, typeof made, Object.getOwnPropertyNames(made).sort().join(), Object.getPrototypeOf(made) === Function.prototype, made.prototype.constructor === made];
  for (const made of [Plain, Failure, Wider, WithoutConstructor, HeirWithoutConstructor]) said.push(describe(made));
  said.push(Plain.make(5).twice(), Plain.made, new Wider(5).twice(), new WithoutConstructor().size(), new HeirWithoutConstructor(6).twice());
  said.push(Object.getPrototypeOf(Wider) === Plain, Object.getPrototypeOf(Failure) === Error, new Wider(1) instanceof Plain, new Failure(1, "x") instanceof Error);
  try { throw new Failure(7, "lost"); } catch (error) { said.push((error as Failure).message, (error as Failure).name, (error as Failure).line); }
  try { (Plain as unknown as () => void)(); } catch (error) { said.push((error as Error).constructor.name); }
  const first = makeAgain(), second = makeAgain();
  said.push(first === second, first.prototype === second.prototype, new first().answer() + new second().answer(), new first() instanceof second, describe(first));
  (first as unknown as { mark: number }).mark = 1;
  said.push("mark" in first, "mark" in second);
  const under = makeAgainUnder(Plain), underWider = makeAgainUnder(Wider);
  said.push(under === underWider, new under(2).thrice(), new underWider(2).thrice(), Object.getPrototypeOf(underWider) === Wider, describe(under));
  const byOne = makeCapturing(1), byTen = makeCapturing(10);
  said.push(new byOne(1).held, new byTen(1).held, byOne === byTen);
  const many: Function[] = [];
  for (let turn = 0; turn < 3; turn++) many.push(class InLoop { static turn = 0; });
  said.push(new Set(many).size, many.map(made => made.name).join());
  function makeOnce(step: number) { return class Once { constructor(public held: number) { this.held += step; } static made = step; }; }
  const once = makeOnce(3);
  Bun.gc(true);
  said.push(new once(1).held, once.made, once.name, describe(once));
  function makeBelowOnce(parent: typeof once) { return class BelowOnce extends parent { more(): number { return this.held + 1; } }; }
  const belowOnce = makeBelowOnce(once);
  Bun.gc(true);
  said.push(new belowOnce(1).more(), Object.getPrototypeOf(belowOnce) === once, Object.getPrototypeOf(belowOnce.prototype) === once.prototype);
  class BelowNull extends (null as unknown as ObjectConstructor) { static here = 1; }
  said.push(Object.getPrototypeOf(BelowNull.prototype), BelowNull.here);
  for (const wrong of [1, {}, () => 1]) { try { said.push(class extends (wrong as unknown as ObjectConstructor) {}.name); } catch (error) { said.push((error as Error).constructor.name); } }
  class Third extends Wider { override twice(): number { return super.twice() * 2; } }
  said.push(new Third(1).twice(), Object.getPrototypeOf(Third.prototype) === Wider.prototype, Third.make === Plain.make);
  console.log(JSON.stringify(said));
`;

test("a class answers as under plain Bun however it is made", async () => {
  using folder = tempDir("a-class-answers-as-plain-bun-however-it-is-made", { "app.ts": program });
  const cwd = String(folder);
  const executable = join(cwd, isWindows ? "app.exe" : "app");
  const built = await run([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", executable], cwd, bunEnv);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toMatchObject({ exitCode: 0 });
  const [plain, compiled] = await Promise.all([run([bunExe(), "app.ts"], cwd), run([executable], cwd)]);
  expect(plain.exitCode).toBe(0);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});
