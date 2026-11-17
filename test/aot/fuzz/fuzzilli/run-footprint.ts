// Does a loop that holds on to nothing hold on to memory? A shape is a loop of millions of turns in which whatever a turn makes is let go in the same turn, or a loop with a huge written bound that ends early.
// `bun <file>` runs such a loop in a few dozen megabytes. The executable may take no more than `--most` times as much (2) and 64 MB on top, and no more than `--slower` times the processor time (4) and a second on top.
//
//   bun run-footprint.ts --bun <the Bun that builds> --work <folder> --finds <folder> [--shape <name>] [--most 2] [--slower 4] [--writes <table>] [--against <earlier table>] [--rise 1.3]
//
// Where `perf` is there it counts the instructions of the executable too, and with `--against` it keeps a shape that takes more than `--rise` times what the table of an earlier build says. A table of the least that
// each shape ever took makes that a ratchet.
// It prints a line a shape: the peak of memory in MB and the seconds of processor time, of `bun <file>` and of the executable. What it keeps: <finds>/footprint-<shape>/{the program, report.txt}.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { withoutInstallingPackages } from "../../harness/without-installing-packages";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    work: { type: "string" },
    finds: { type: "string" },
    shape: { type: "string", default: "" },
    most: { type: "string", default: "2" },
    slower: { type: "string", default: "4" },
    against: { type: "string", default: "" },
    writes: { type: "string", default: "" },
    rise: { type: "string", default: "1.3" },
  },
});
const { bun, work, finds } = options as Record<string, string>;
if (!work || !finds) throw new Error("Expected --work and --finds");
withoutInstallingPackages(work);

/** The body of `function run(most)`, which returns a number. */
const shapes: Record<string, [turns: number, body: string]> = {
  aStoreAtTheLengthThenAPop: [
    50_000_000,
    `const list = []; let seen = 0; for (let i = 0; i < most; i++) { list[list.length] = i; seen = (seen + (list.pop() & 1)) | 0; } return seen;`,
  ],
  aPushThenAPop: [
    50_000_000,
    `const list = []; let seen = 0; for (let i = 0; i < most; i++) { list.push(i); seen = (seen + (list.pop() & 1)) | 0; } return seen;`,
  ],
  aFillThatThrowsEarly: [
    250_000_000,
    `const list = []; const next = i => { if (i > 3) throw new RangeError("enough"); return i; }; try { for (let i = 0; i < most; i++) list[i] = next(i); } catch (error) {} return list.length;`,
  ],
  aFillThatLeavesEarly: [
    250_000_000,
    `const list = []; for (let i = 0; i < most; i++) { if (i > 3) break; list[i] = i; } return list.length;`,
  ],
  pushesThatLeaveEarly: [
    250_000_000,
    `const list = []; for (let i = 0; i < most; i++) { if (i > 3) break; list.push(i); } return list.length;`,
  ],
  aListEmptiedNowAndThen: [
    30_000_000,
    `const list = []; let seen = 0; for (let i = 0; i < most; i++) { list.push(i); if (list.length > 1000) { seen += list.length; list.length = 0; } } return seen;`,
  ],
  aQueue: [
    10_000_000,
    `const queue = []; let seen = 0; for (let i = 0; i < most; i++) { queue.push(i); if (queue.length > 8) seen = (seen + queue.shift()) | 0; } return seen;`,
  ],
  aTextThatIsDropped: [
    5_000_000,
    `let seen = 0; for (let i = 0; i < most; i++) { let text = ""; for (let j = 0; j < 8; j++) text += j + ","; seen += text.length; } return seen;`,
  ],
  aTextCutAndDropped: [
    5_000_000,
    `const text = "a,b,c,d,e,f"; let seen = 0; for (let i = 0; i < most; i++) seen += text.split(",").length + text.slice(i & 3).length; return seen;`,
  ],
  closuresThatAreDropped: [
    30_000_000,
    `let seen = 0; for (let i = 0; i < most; i++) { const add = () => i + 1; seen = (seen + add()) | 0; } return seen;`,
  ],
  recordsThatAreDropped: [
    30_000_000,
    `let seen = 0; for (let i = 0; i < most; i++) { const made = { a: i, b: i + 1 }; seen = (seen + made.a + made.b) | 0; } return seen;`,
  ],
  recordsSeenByACall: [
    30_000_000,
    `const look = [made => made.a + made.b][JSON.parse("0")]; let seen = 0; for (let i = 0; i < most; i++) seen = (seen + look({ a: i, b: i + 1 })) | 0; return seen;`,
  ],
  listsThatAreDropped: [
    30_000_000,
    `let seen = 0; for (let i = 0; i < most; i++) { const made = [i, i + 1, i + 2]; seen = (seen + made[1] + made.length) | 0; } return seen;`,
  ],
  viewsThatAreDropped: [
    3_000_000,
    `let seen = 0; for (let i = 0; i < most; i++) { const made = new Uint8Array(64); made[i & 63] = 1; seen += made[i & 63]; } return seen;`,
  ],
  instancesThatAreDropped: [
    30_000_000,
    `class Point { constructor(x) { this.x = x; this.y = x + 1; } sum() { return this.x + this.y; } } let seen = 0; for (let i = 0; i < most; i++) seen = (seen + new Point(i).sum()) | 0; return seen;`,
  ],
  aMapThatStaysSmall: [
    10_000_000,
    `const map = new Map(); let seen = 0; for (let i = 0; i < most; i++) { map.set(i, i); map.delete(i - 4); seen = map.size; } return seen;`,
  ],
  aSetThatStaysSmall: [
    10_000_000,
    `const set = new Set(); let seen = 0; for (let i = 0; i < most; i++) { set.add(i); set.delete(i - 4); seen = set.size; } return seen;`,
  ],
  aRecordWhoseNamesComeAndGo: [
    3_000_000,
    `const held = {}; let seen = 0; for (let i = 0; i < most; i++) { held["k" + (i & 7)] = i; delete held["k" + ((i + 4) & 7)]; seen = (seen + i) | 0; } return seen;`,
  ],
  generatorsThatAreUsedUp: [
    5_000_000,
    `function* three(i) { yield i; yield i + 1; yield i + 2; } let seen = 0; for (let i = 0; i < most; i++) for (const each of three(i)) seen = (seen + each) | 0; return seen;`,
  ],
  argumentsThatAreSpread: [
    10_000_000,
    `const sum = (...all) => all[0] + all.length; let seen = 0; for (let i = 0; i < most; i++) seen = (seen + sum(...[i, i, i])) | 0; return seen;`,
  ],
  patternsOverLists: [
    20_000_000,
    `let a = 0, b = 1; for (let i = 0; i < most; i++) [a, b] = [b, (a + i) | 0]; return a + b;`,
  ],
  errorsThatAreCaught: [
    1_000_000,
    `let seen = 0; for (let i = 0; i < most; i++) { try { throw new RangeError("turn"); } catch (error) { seen += error.message.length; } } return seen;`,
  ],
  numbersThatAreFractions: [
    50_000_000,
    `let seen = 0.5; const held = { value: 0.5 }; for (let i = 0; i < most; i++) { held.value = held.value * 0.5 + i; seen += held.value; } return seen > 0 ? 1 : 0;`,
  ],
  largeWholeNumbers: [
    3_000_000,
    `let seen = 1n; for (let i = 0; i < most; i++) seen = (seen * 3n + 1n) % 1000003n; return Number(seen);`,
  ],
};
const waits: Record<string, [turns: number, body: string]> = {
  awaitsInALoop: [
    5_000_000,
    `let seen = 0; for (let i = 0; i < most; i++) seen = (seen + (await i)) | 0; return seen;`,
  ],
  smallAsyncCalls: [
    3_000_000,
    `const one = async i => i + 1; let seen = 0; for (let i = 0; i < most; i++) seen = (seen + (await one(i))) | 0; return seen;`,
  ],
  promisesMadeAndAwaited: [
    2_000_000,
    `let seen = 0; for (let i = 0; i < most; i++) seen = (seen + (await Promise.all([i, i + 1])).length) | 0; return seen;`,
  ],
};
/** Whole programs in TypeScript: the list comes in as a parameter that is said to hold numbers, the bound as one that is said to be a number. */
const typed: Record<string, string> = {
  aStoreAtTheLengthOfATypedListThenAPop: `function churn(list: number[], most: number): number { let seen = 0; for (let i = 0; i < most; i++) { list[list.length] = i; seen = (seen + (list.pop()! & 1)) | 0; } return seen; }\nconst kept: number[] = [];\nconsole.log(churn(kept, Number(JSON.parse("50000000"))), kept.length);`,
  aFillOfATypedListThatThrowsEarly: `function collect(list: number[], most: number, next: (at: number) => number): number { for (let i = 0; i < most; i++) list[i] = next(i); return list.length; }\nconst kept: number[] = [];\nlet said = "none";\ntry { collect(kept, Number(JSON.parse("250000000")), at => { if (at === 3) throw new RangeError("enough"); return at; }); } catch (error) { said = (error as Error).name; }\nconsole.log(said, kept.length);`,
  aFillOfATypedListInAGenerator: `function* numbers(list: number[], most: number): Generator<number> { for (let i = 0; i < most; i++) { list[i] = i; yield i; } }\nconst kept: number[] = [];\nconst steps = numbers(kept, Number(JSON.parse("250000000")));\nsteps.next(); steps.next();\nconsole.log(kept.length);`,
  aFillOfATypedListThatLeavesEarly: `function collect(list: number[], most: number): number { for (let i = 0; i < most; i++) { if (list.length > 3) break; list[i] = i; } return list.length; }\nconst kept: number[] = [];\nconsole.log(collect(kept, Number(JSON.parse("250000000"))));`,
  pushesOntoATypedListThatLeaveEarly: `function collect(list: number[], most: number): number { for (let i = 0; i < most; i++) { if (list.length > 3) return i; list.push(i); } return list.length; }\nconst kept: number[] = [];\nconsole.log(collect(kept, Number(JSON.parse("250000000"))));`,
  aFillOfATypedListByAStride: `function collect(list: number[], most: number): number { for (let i = 0; i < most; i += 50000000) list[i & 7] = i; return list.length; }\nconst kept: number[] = [];\nconsole.log(collect(kept, Number(JSON.parse("250000000"))));`,
  aTextOutOfATypedBound: `function join(most: number, stop: number): number { let text = ""; for (let i = 0; i < most; i++) { if (i === stop) break; text += i; } return text.length; }\nconsole.log(join(Number(JSON.parse("250000000")), Number(JSON.parse("4"))));`,
};
const upTo = (n: number, each: (at: number) => string, between = "\n") =>
  Array.from({ length: n }, (_, at) => each(at)).join(between);
/** Whole programs in JavaScript in which much of one kind meets one deed: what costs `bun <file>` a moment may cost the executable the square of it. */
const many: Record<string, string> = {
  namesAddedWhereAnAccessorOnceLay: `class Bag { constructor() { this.kind = "bag"; } }\nfunction fill(bag, count) { for (let i = 0; i < count; i++) bag["k" + i] = i; return count; }\nconst bag = new Bag(), name = JSON.parse('"lazy"');\nObject.defineProperty(bag, name, { get() { return 1; }, configurable: true });\nObject.defineProperty(bag, name, { value: 1, writable: true, enumerable: true, configurable: true });\nfill(bag, JSON.parse("160000"));\nconsole.log(Object.keys(bag).length);`,
  namesAddedToAnInstance: `class Bag { constructor() { this.kind = "bag"; } }\nfunction fill(bag, count) { for (let i = 0; i < count; i++) bag["k" + i] = i; return count; }\nconst bag = new Bag();\nfill(bag, JSON.parse("160000"));\nconsole.log(Object.keys(bag).length);`,
  namesAddedAndTakenAway: `const bag = { kind: "bag" };\nfunction churn(bag, count) { for (let i = 0; i < count; i++) { bag["k" + i] = i; if (i > 100) delete bag["k" + (i - 100)]; } return count; }\nchurn(bag, JSON.parse("300000"));\nconsole.log(Object.keys(bag).length);`,
  aMethodStoredOverDownADeepRowOfClasses: `const swap = (0, eval)("(classes) => { for (const one of classes) one.prototype.tell = () => 2; }");\nclass K0 { tell() { return 1; } }\n${upTo(999, at => `class K${at + 1} extends K${at} {}`)}\n${upTo(499, at => `function r${2 * at + 1}(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o${2 * at + 1} = new K${2 * at + 1}();`)}\nfunction all() { return ${upTo(499, at => `r${2 * at + 1}(o${2 * at + 1})`, " + ")}; }\nconsole.log(all());\nswap([${upTo(1000, at => `K${at}`, ", ")}]);\nconsole.log(all());`,
  aMethodStoredOverOnManyClassesSideBySide: `const swap = (0, eval)("(classes) => { for (const one of classes) one.prototype.tell = () => 2; }");\n${upTo(1000, at => `class K${at} { tell() { return 1; } }`)}\n${upTo(500, at => `function r${at}(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o${at} = new K${at}();`)}\nfunction all() { return ${upTo(500, at => `r${at}(o${at})`, " + ")}; }\nconsole.log(all());\nswap([${upTo(1000, at => `K${at}`, ", ")}]);\nconsole.log(all());`,
  listenersLaidAndTakenAway: `import { EventEmitter } from "node:events";\nconst emitter = new EventEmitter(); emitter.setMaxListeners(0);\nlet heard = 0;\nfor (let i = 0; i < JSON.parse("200000"); i++) { const listener = () => { heard++; }; emitter.on("turn", listener); if (i % 100 === 0) emitter.emit("turn"); emitter.off("turn", listener); }\nconsole.log(heard);`,
  keysOfAMapThatGrows: `const map = new Map();\nfor (let i = 0; i < JSON.parse("1000000"); i++) map.set("k" + i, i);\nlet sum = 0; for (const [, value] of map) sum = (sum + value) | 0;\nconsole.log(map.size, sum);`,
  aTextThatGrowsLong: `let text = "";\nfor (let i = 0; i < JSON.parse("3000000"); i++) text += i & 7;\nconsole.log(text.length, text.charCodeAt(text.length >> 1));`,
  aListThatIsShiftedEmpty: `const list = Array.from({ length: JSON.parse("100000") }, (_, at) => at);\nlet sum = 0; while (list.length) sum = (sum + list.shift()) | 0;\nconsole.log(sum);`,
  aListSortedAndSearched: `const list = Array.from({ length: JSON.parse("300000") }, (_, at) => (at * 7919) % 300007);\nlist.sort((a, b) => a - b);\nlet found = 0; for (let i = 0; i < 300; i++) found += list.indexOf(list[list.length - 1 - i]) > 0 ? 1 : 0;\nconsole.log(found);`,
};
const extension = (name: string) => (name in typed ? "ts" : "js");
const write = (name: string) =>
  name in many
    ? many[name] + "\nexport {};\n"
    : name in typed
      ? typed[name] + "\nexport {};\n"
      : name in waits
        ? `async function run(most) { ${waits[name][1]} }\nconsole.log(await run(JSON.parse("${waits[name][0]}")));\nexport {};\n`
        : `function run(most) { ${shapes[name][1]} }\nconsole.log(run(JSON.parse("${shapes[name][0]}")));\nexport {};\n`;

const folder = join(work, `footprint-${process.pid}`);
const perf = Bun.which("perf");
async function run(command: string[], seconds: number, counts = false) {
  const counted = join(folder, "counted.txt");
  const child = Bun.spawn({
    cmd: counts && perf ? [perf, "stat", "-x,", "-e", "instructions:u", "-o", counted, "--", ...command] : command,
    cwd: folder,
    env: { ...process.env, NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: seconds * 1000,
    killSignal: "SIGKILL",
  });
  const [stdout, exitCode] = [await new Response(child.stdout).text(), await child.exited];
  const used = child.resourceUsage()!;
  return {
    stdout,
    end: child.signalCode ?? String(exitCode),
    megabytes: used.maxRSS / 2 ** 20,
    seconds: Number(used.cpuTime.total) / 1e6,
    /** Millions of instructions, which are nearly the same from run to run. */
    instructions:
      counts && perf && existsSync(counted)
        ? Number(/^(\d+),,instructions/m.exec(readFileSync(counted, "utf8"))?.[1]) / 1e6
        : NaN,
  };
}
const earlier = new Map<string, number>();
if (options.against && existsSync(options.against))
  for (const line of readFileSync(options.against, "utf8").split("\n")) {
    const [shape, instructions] = line.split("\t");
    if (instructions) earlier.set(shape, Number(instructions));
  }
const table: string[] = [];
for (const shape of options.shape
  ? [options.shape]
  : [...Object.keys(typed), ...Object.keys(many), ...Object.keys(shapes), ...Object.keys(waits)]) {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const program = "program." + extension(shape);
  writeFileSync(join(folder, program), write(shape));
  const plain = await run([bun, program], 120);
  await run(
    [bun, "build", "--compile", "--aot", "--aot-threads=1", "./" + program, "--outfile", join(folder, "executable")],
    300,
  );
  const ours = existsSync(join(folder, "executable")) ? await run([join(folder, "executable")], 480, true) : undefined;
  if (ours && ours.instructions > 0) table.push(`${shape}\t${ours.instructions.toFixed(0)}`);
  const before = earlier.get(shape);
  const why = !ours
    ? "the build fails"
    : ours.end !== plain.end || ours.stdout !== plain.stdout
      ? `another end or answer: ${ours.end} ${ours.stdout.trim().slice(0, 40)} for ${plain.end} ${plain.stdout.trim().slice(0, 40)}`
      : ours.megabytes > plain.megabytes * Number(options.most) + 64
        ? `the peak of memory is ${(ours.megabytes / plain.megabytes).toFixed(1)} times that of bun <file>`
        : ours.seconds > plain.seconds * Number(options.slower) + 1
          ? `it takes ${(ours.seconds / plain.seconds).toFixed(1)} times the processor time of bun <file>`
          : before !== undefined && ours.instructions > before * Number(options.rise) + 20
            ? `it takes ${(ours.instructions / before).toFixed(2)} times the instructions that the earlier table says (${before.toFixed(0)} M)`
            : "";
  const line = `${shape} | ${plain.megabytes.toFixed(0)} MB ${plain.seconds.toFixed(2)} s | ${ours ? `${ours.megabytes.toFixed(0)} MB ${ours.seconds.toFixed(2)} s ${ours.instructions.toFixed(0)} M` : "no executable"}`;
  console.log(line + (why ? ` | KEPT: ${why}` : ""));
  if (!why) continue;
  mkdirSync(join(finds, `footprint-${shape}`), { recursive: true });
  writeFileSync(join(finds, `footprint-${shape}`, program), write(shape));
  writeFileSync(join(finds, `footprint-${shape}`, "report.txt"), `footprint: ${why}\n${bun}\n${line}\n`);
}
if (options.writes) writeFileSync(options.writes, table.join("\n") + "\n");
rmSync(folder, { recursive: true, force: true });
