// A test that passes its time limit shows nothing of the child that it waited for. This says where the threads of such a child are:
// asleep in the kernel or running, and how much of the processor each has used between two looks.
import { readdirSync, readFileSync } from "node:fs";

type Look = Map<string, { name: string; state: string; ticks: number; where: string }>;

function look(pid: number): Look {
  const threads: Look = new Map();
  for (const tid of readdirSync(`/proc/${pid}/task`)) {
    const read = (file: string) => {
      try {
        return readFileSync(`/proc/${pid}/task/${tid}/${file}`, "utf8").trim();
      } catch {
        return "";
      }
    };
    // The name may hold spaces and parentheses: the other fields come behind its last one.
    const stat = read("stat");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    threads.set(tid, {
      name: read("comm"),
      state: fields[0],
      ticks: Number(fields[11]) + Number(fields[12]),
      // `syscall`: the number of the system call that the thread is in, its arguments, the stack pointer and the program counter.
      where: `${read("wchan") || "-"} ${read("syscall")}`,
    });
  }
  return threads;
}

/** While the child has not ended, its threads go to stderr: after `first` milliseconds, and then every `every`. Only Linux has the files. */
export function saysWhereItIs(pid: number, cmd: string[], first = 20_000, every = 30_000): Disposable {
  let timer: Timer | undefined;
  if (process.platform !== "linux") return { [Symbol.dispose]() {} };
  const started = performance.now();
  const later = (run: () => void, ms: number) => {
    timer = setTimeout(run, ms);
    timer.unref();
  };
  const say = () => {
    let before: Look;
    try {
      before = look(pid);
    } catch {
      return;
    }
    later(() => {
      let after: Look;
      let mapped = "";
      try {
        after = look(pid);
        mapped = readFileSync(`/proc/${pid}/maps`, "utf8").split("\n", 1)[0];
      } catch {
        return;
      }
      const lines = [...after].map(
        ([tid, thread]) =>
          `  ${tid} ${thread.name}: ${thread.state}, ${thread.ticks - (before.get(tid)?.ticks ?? 0)} ticks in a second, ${thread.where}`,
      );
      const seconds = Math.round((performance.now() - started) / 1000);
      console.error(
        `${cmd.join(" ")} (${pid}) has not ended after ${seconds} s. Its threads:\n${lines.join("\n")}\n  mapped: ${mapped}`,
      );
      later(say, every - 1000);
    }, 1000);
  };
  later(say, first);
  return {
    [Symbol.dispose]() {
      clearTimeout(timer);
    },
  };
}
