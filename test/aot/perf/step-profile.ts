// bun step-profile.ts <functions listed a door> <command> [arguments ..]: every instruction that the first thread of the command executes between the two times it sends itself SIGUSR2, by where it lies:
// in the code that the compiler made, or behind a door: the first function of the run time that is entered from that code. For each door: how often it is entered, its instructions, and the functions they lie in.
// Exact, as ./count-steps.ts is: the system stops the thread behind every instruction. What is flat in the profile of a launch is sharp here: a hundred items of a row of ./first-executions.ts take the same road.
// The names come from the executable (nm, readelf), so the Bun that builds it must have its symbols: bun-profile.
//
//   bun test/aot/perf/first-executions.ts <the Bun that builds> <a folder> <a pattern for the row's name> [items]     writes and builds the row, and says the command
import { dlopen, ptr } from "bun:ffi";
import { readFileSync } from "fs";

const { symbols: c } = dlopen("libc.so.6", {
  ptrace: { args: ["i64", "i32", "u64", "u64"], returns: "i64_fast" },
  waitpid: { args: ["i32", "ptr", "i32"], returns: "i32" },
  kill: { args: ["i32", "i32"], returns: "i32" },
});
const PTRACE_PEEKUSER = 3, PTRACE_CONT = 7, PTRACE_SINGLESTEP = 9, PTRACE_SEIZE = 0x4206;
const offsetOfProgramCounter = 16 * 8;
const WUNTRACED = 2, __WALL = 0x40000000;
const SIGTRAP = 5, SIGKILL = 9, SIGUSR2 = 12, SIGCONT = 18;
const rowsOfDoor = Number(process.argv[2]);
const command = process.argv.slice(3);

const child = Bun.spawn({ cmd: ["/bin/sh", "-c", 'kill -STOP $$; exec "$0" "$@"', ...command], stdin: "ignore", stdout: "inherit", stderr: "inherit" });
const pid = child.pid;
const status = new Int32Array(1);
const wait = (options: number) => (c.waitpid(pid, ptr(status), options) === pid ? status[0] : -1);
const isStopped = (status: number) => (status & 0xff) === 0x7f;
function giveUp(why: string): never {
  c.kill(pid, SIGKILL);
  throw new Error(why);
}
if (!isStopped(wait(WUNTRACED))) giveUp("the child did not stop");
if (c.ptrace(PTRACE_SEIZE, pid, 0, 0) !== 0) giveUp("ptrace is refused here");
wait(__WALL);
c.kill(pid, SIGCONT);
c.ptrace(PTRACE_CONT, pid, 0, 0);

type Mapping = { start: number; end: number; offset: number };
let own: Mapping[] = [];
function readMappings() {
  const path = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0].replace(/^\.\//, process.cwd() + "/");
  own = readFileSync(`/proc/${pid}/maps`, "utf8")
    .split("\n")
    .map(line => /^([0-9a-f]+)-([0-9a-f]+) r-xp ([0-9a-f]+) \S+ \S+ +(\/.*)$/.exec(line))
    .filter(found => found && found[4] === path)
    .map(found => ({ start: parseInt(found![1], 16), end: parseInt(found![2], 16), offset: parseInt(found![3], 16) }))
    .sort((one, other) => one.offset - other.offset);
}

const at = new Map<number, Map<number, number>>();
const entries = new Map<number, number>();
let steps = 0, compiled = 0, marks = 0, door = 0;
for (;;) {
  const now = wait(__WALL);
  if (now === -1 || !isStopped(now)) break;
  let signal = (now >> 8) & 0xff;
  if (now >> 16) signal = 0;
  else if (signal === SIGUSR2) {
    if (++marks === 1) readMappings();
    signal = 0;
  } else if (signal === SIGTRAP) {
    if (marks === 1) {
      steps++;
      const pc = c.ptrace(PTRACE_PEEKUSER, pid, offsetOfProgramCounter, 0);
      let inCompiled = false;
      for (let index = 1; index < own.length; index++) if (pc >= own[index].start && pc < own[index].end) inCompiled = true;
      if (inCompiled) {
        compiled++;
        door = 0;
      } else {
        if (!door) {
          door = pc;
          entries.set(pc, (entries.get(pc) ?? 0) + 1);
        }
        let counts = at.get(door);
        if (!counts) at.set(door, (counts = new Map()));
        counts.set(pc, (counts.get(pc) ?? 0) + 1);
      }
    }
    signal = 0;
  }
  c.ptrace(marks === 1 ? PTRACE_SINGLESTEP : PTRACE_CONT, pid, 0, signal);
}

// Bun's own code is the first mapping of the file that can be executed. Its symbols are addresses as linked: the file's program header says where the mapping's offset lies.
const listing = Bun.spawnSync({ cmd: ["nm", "-n", "-C", "--defined-only", command[0]], stdout: "pipe", stderr: "ignore" }).stdout.toString();
const symbols = listing.split("\n").map(line => /^([0-9a-f]+) [tTwW] (.*)$/.exec(line)).filter(Boolean).map(found => [parseInt(found![1], 16), found![2]] as const);
const headers = Bun.spawnSync({ cmd: ["readelf", "-lW", command[0]], stdout: "pipe" }).stdout.toString();
const segment = headers.split("\n").map(line => /^\s*LOAD\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+\S+\s+\S+\s+\S+\s+R E/.exec(line)).find(Boolean);
const bias = own.length && segment ? own[0].start - own[0].offset + parseInt(segment[1], 16) - parseInt(segment[2], 16) : 0;
function nameOf(pc: number) {
  if (!own.length || pc < own[0].start || pc >= own[0].end) return "[a library outside]";
  const address = pc - bias;
  let low = 0, high = symbols.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (symbols[middle][0] <= address) low = middle;
    else high = middle - 1;
  }
  return symbols[low]?.[1].replace(/\(.*/, "").slice(0, 90) ?? "?";
}
const doors = new Map<string, { entries: number; steps: number; inside: Map<string, number> }>();
for (const [first, counts] of at) {
  const name = nameOf(first);
  let row = doors.get(name);
  if (!row) doors.set(name, (row = { entries: 0, steps: 0, inside: new Map() }));
  row.entries += entries.get(first) ?? 0;
  for (const [pc, times] of counts) {
    row.steps += times;
    const inside = nameOf(pc);
    row.inside.set(inside, (row.inside.get(inside) ?? 0) + times);
  }
}
console.log(`steps ${steps} | in the code that the compiler made ${compiled} | marks ${marks}`);
for (const [name, row] of [...doors].sort((one, other) => other[1].steps - one[1].steps).slice(0, 14)) {
  console.log(`DOOR ${name} | entered ${row.entries} | ${row.steps} steps | ${Math.round(row.steps / row.entries)} each`);
  for (const [inside, times] of [...row.inside].sort((one, other) => other[1] - one[1]).slice(0, rowsOfDoor)) console.log(`     ${String(Math.round((times / row.entries) * 10) / 10).padStart(8)} each | ${inside}`);
}
