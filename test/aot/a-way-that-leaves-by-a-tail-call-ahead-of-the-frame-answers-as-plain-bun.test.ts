// A function tests one flag and leaves by a tail call; the rest of it makes calls and needs a frame. The way out may run ahead of the frame. It answers as under plain Bun
// with arguments beyond the registers, with a callee whose frame is larger than what is left of the stack, with a handler round the call, over millions of tail calls in a row,
// and where the callee throws and the error's stack is read. Each function is also handed an object of another shape, whose slower way makes the same tail call.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `
  class Leaf { kind!: number; constructor(public flags: number, public weight: number, public next: Leaf | undefined) {} }
  const makeLeaf = (flags: number, weight: number, next: Leaf | undefined): Leaf => new Leaf(flags, weight, next);
  type Table = { scale: number; seen: number[] };
  const said: unknown[] = [];
  const lookAlike = (flags: number, weight: number, next: Leaf | undefined): Leaf => { const made = JSON.parse('{"extra":1,"weight":' + weight + ',"flags":' + flags + '}'); made.next = next; return made; };

  function mapped(leaf: Leaf, table: Table): number {
    let sum = 0;
    for (let walked: Leaf | undefined = leaf; walked; walked = walked.next) { table.seen.push(walked.weight); sum += walked.weight * table.scale; }
    return sum;
  }
  function heavy(leaf: Leaf, table: Table, depth: number): number {
    table.seen.push(depth);
    return table.seen.length + leaf.weight + depth;
  }
  function pick(leaf: Leaf, table: Table, depth: number): number {
    const flags = leaf.flags;
    if (flags & 1) return mapped(leaf, table);
    if (flags & 2) {
      const kind = leaf.kind;
      if (kind & 8) return heavy(leaf, table, kind) + kind;
      const inner = leaf.next;
      if (!inner) return -1;
      const first = pick(inner, table, depth + 1);
      return first + heavy(leaf, table, depth) + (flags >> 4) + heavy(inner, table, first) + inner.weight;
    }
    if (flags & 4) return heavy(leaf, table, depth) + flags;
    return leaf.weight;
  }

  function mappedWide(leaf: Leaf, table: Table, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number {
    table.seen.push(a, h);
    return mapped(leaf, table) + a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8;
  }
  function pickWide(leaf: Leaf, table: Table, depth: number): number {
    const flags = leaf.flags;
    if (flags & 1) return mappedWide(leaf, table, depth, depth + 1, depth + 2, depth + 3, depth + 4, depth + 5, depth + 6, flags);
    if (flags & 2) {
      const kind = leaf.kind;
      if (kind & 8) return heavy(leaf, table, kind) + kind;
      return heavy(leaf, table, depth) + heavy(leaf, table, flags) + flags;
    }
    return leaf.weight;
  }

  let deepest = 0;
  function largeFrame(leaf: Leaf, table: Table, depth: number): number {
    const a = depth + 1, b = depth + 2, c = depth + 3, d = depth + 4, e = depth + 5, f = depth + 6, g = depth + 7, h = depth + 8, i = depth + 9, j = depth + 10, k = depth + 11, l = depth + 12;
    if (depth > deepest) deepest = depth;
    const below = 1 + pickDeep(leaf, table, depth + 1);
    return below + a + b + c + d + e + f + g + h + i + j + k + l;
  }
  function pickDeep(leaf: Leaf, table: Table, depth: number): number {
    const flags = leaf.flags;
    if (flags & 1) return largeFrame(leaf, table, depth);
    if (flags & 2) {
      const kind = leaf.kind;
      if (kind & 8) return heavy(leaf, table, kind) + kind;
      return heavy(leaf, table, depth) + heavy(leaf, table, flags) + flags;
    }
    return leaf.weight;
  }

  function mappedThrows(leaf: Leaf, table: Table): number {
    table.seen.push(leaf.weight);
    if (leaf.weight > 2) throw new RangeError("too heavy: " + leaf.weight);
    return leaf.weight * table.scale;
  }
  function pickGuarded(leaf: Leaf, table: Table, depth: number): number {
    const flags = leaf.flags;
    try {
      if (flags & 1) return mappedThrows(leaf, table);
      if (flags & 2) {
        const kind = leaf.kind;
        if (kind & 8) return heavy(leaf, table, kind) + kind;
        return heavy(leaf, table, depth) + heavy(leaf, table, flags) + flags;
      }
    } catch (error) {
      return -(error as Error).message.length - heavy(leaf, table, depth);
    }
    return leaf.weight;
  }
  function pickThrows(leaf: Leaf, table: Table, depth: number): number {
    const flags = leaf.flags;
    if (flags & 1) return mappedThrows(leaf, table);
    if (flags & 2) {
      const kind = leaf.kind;
      if (kind & 8) return heavy(leaf, table, kind) + kind;
      return heavy(leaf, table, depth) + heavy(leaf, table, flags) + flags;
    }
    return leaf.weight;
  }
  function outermost(leaf: Leaf, table: Table): unknown {
    try {
      return 1 + pickThrows(leaf, table, 0);
    } catch (error) {
      const stack = String((error as Error).stack);
      return [(error as Error).message, stack.indexOf("mappedThrows") >= 0, stack.indexOf("mappedThrows") < stack.indexOf("outermost")];
    }
  }

  function pong(leaf: Leaf, table: Table, left: number): number {
    if (left === 0) return table.scale;
    return ping(leaf, table, left - 1);
  }
  function ping(leaf: Leaf, table: Table, left: number): number {
    const flags = leaf.flags;
    if (flags & 1) return pong(leaf, table, left);
    if (flags & 2) {
      const kind = leaf.kind;
      if (kind & 8) return heavy(leaf, table, kind) + kind;
      return heavy(leaf, table, left) + heavy(leaf, table, flags) + flags;
    }
    return leaf.weight;
  }

  (globalThis as unknown as { kept: unknown[] }).kept = [pick, pickWide, pickDeep, pickGuarded, pickThrows, ping];
  for (const make of [makeLeaf, lookAlike]) {
    const table: Table = { scale: 3, seen: [] };
    const last = make(1, 2, undefined), middle = make(4, 5, last), first = make(2 | 32, 7, middle), plain = make(0, 9, undefined), alone = make(2, 1, undefined);
    alone.kind = 12; first.kind = 3;
    for (const leaf of [last, middle, first, plain, alone, make(2, 3, last), make(1, 4, first)]) said.push(pick(leaf, table, 1), pickWide(leaf, table, 2), pickGuarded(leaf, table, 3), outermost(leaf, table));
    said.push(table.seen.length, table.seen.slice(-6).join());
    said.push(ping(last, table, 3_000_000), ping(first, table, 5), ping(plain, table, 5));
    deepest = 0;
    try { said.push(pickDeep(last, table, 0)); } catch (error) { said.push((error as Error).constructor.name, deepest > 500); }
    said.push(pickDeep(first, table, 0), pickDeep(plain, table, 0), pick(first, table, 1));
  }
  console.log(JSON.stringify(said));
`;

test("a way that leaves by a tail call ahead of the frame answers as under plain Bun", async () => {
  using folder = tempDir("a-way-that-leaves-by-a-tail-call-ahead-of-the-frame", { "app.ts": program });
  const cwd = String(folder);
  const executable = join(cwd, isWindows ? "app.exe" : "app");
  const built = await run([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", executable], cwd, bunEnv);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toMatchObject({ exitCode: 0 });
  const [plain, compiled] = await Promise.all([run([bunExe(), "app.ts"], cwd), run([executable], cwd)]);
  expect(plain.exitCode).toBe(0);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});
