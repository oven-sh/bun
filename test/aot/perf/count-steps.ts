// bun count-steps.ts <command> [arguments ..]: the instructions that the first thread of the command executes between the two times it sends itself SIGUSR2, on stderr:
// `steps <all> compiled <those in the code that the compiler made> marks 2`. What native code takes goes by the processor too: it picks its routines for copying and for text by the model.
// Behind AOT_PERF_MOST_STEPS steps it ends the command and says `marks 1`.
// No counter of the processor, which the machines of CI do not have: the system stops the thread behind every instruction. Exact, the same on every run, and some ten thousand times slower
// than the thread by itself, so what lies between the marks is short.
import { dlopen, ptr } from "bun:ffi";
import { readFileSync } from "fs";

const { symbols: c } = dlopen("libc.so.6", {
  ptrace: { args: ["i64", "i32", "u64", "u64"], returns: "i64_fast" },
  waitpid: { args: ["i32", "ptr", "i32"], returns: "i32" },
  kill: { args: ["i32", "i32"], returns: "i32" },
});
const PTRACE_PEEKUSER = 3, PTRACE_CONT = 7, PTRACE_SINGLESTEP = 9, PTRACE_SEIZE = 0x4206;
/** Of `rip` in `struct user`. */
const offsetOfProgramCounter = 16 * 8;
const WUNTRACED = 2, __WALL = 0x40000000;
const SIGTRAP = 5, SIGKILL = 9, SIGUSR2 = 12, SIGCONT = 18;

// Nothing runs between fork and exec here, so the child stops itself and goes on into the command once it is watched.
const child = Bun.spawn({
  cmd: ["/bin/sh", "-c", 'kill -STOP $$; exec "$0" "$@"', ...process.argv.slice(2)],
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
});
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

const mostSteps = Number(process.env.AOT_PERF_MOST_STEPS) || Infinity;

/** The images lie behind Bun's own code in the file of the executable. */
function findCompiledCode() {
  const mappings = readFileSync(`/proc/${pid}/maps`, "utf8")
    .split("\n")
    .map(line => /^([0-9a-f]+)-([0-9a-f]+) r-xp ([0-9a-f]+) \S+ \S+ +(\/.*)$/.exec(line))
    .filter(found => found && found[4] === readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0].replace(/^\.\//, process.cwd() + "/"))
    .map(found => ({ start: parseInt(found![1], 16), end: parseInt(found![2], 16), offset: parseInt(found![3], 16) }))
    .sort((one, other) => one.offset - other.offset);
  return mappings.slice(1);
}

let steps = 0;
let compiled = 0;
let code: { start: number; end: number }[] = [];
let marks = 0;
let exitCode = 1;
for (;;) {
  const now = wait(__WALL);
  if (now === -1) break;
  if (!isStopped(now)) {
    exitCode = now & 0x7f ? 128 + (now & 0x7f) : (now >> 8) & 0xff;
    break;
  }
  let signal = (now >> 8) & 0xff;
  if (now >> 16) signal = 0;
  else if (signal === SIGUSR2) {
    if (++marks === 1) code = findCompiledCode();
    signal = 0;
  } else if (signal === SIGTRAP) {
    if (marks === 1) {
      steps++;
      const at = c.ptrace(PTRACE_PEEKUSER, pid, offsetOfProgramCounter, 0);
      if (code.some(({ start, end }) => at >= start && at < end)) compiled++;
      if (steps > mostSteps) {
        c.kill(pid, SIGKILL);
        break;
      }
    }
    signal = 0;
  }
  c.ptrace(marks === 1 ? PTRACE_SINGLESTEP : PTRACE_CONT, pid, 0, signal);
}
console.error(`steps ${steps} compiled ${compiled} marks ${marks}`);
process.exit(marks === 2 ? exitCode : steps > mostSteps ? 0 : 1);
