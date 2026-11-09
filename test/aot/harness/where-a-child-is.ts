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

/**
 * A child with one of these has a heap that is small on purpose: it ends in a second or two, or it does not end.
 * A cell cage of 0 MB is no cage, and no limit.
 */
export const hasSmallHeap = (env: Record<string, string | undefined>) =>
  !!(Number(env.BUN_JSC_markedBlockCageSizeInMB) || env.BUN_JSC_structureHeapSizeInKB);

/**
 * While the child has not ended, its threads go to `say`: after `first` milliseconds, and then every `every`, as long as they are not
 * where the last look found them. Two looks that are `span` apart make one list. Only Linux has the files.
 */
export function saysWhereItIs(
  pid: number,
  cmd: string[],
  { first = 20_000, every = 30_000, span = 1000, say = console.error as (text: string) => void } = {},
): Disposable & { readonly lists: number } {
  let timer: Timer | undefined;
  let lists = 0;
  let said = "";
  const ends = {
    get lists() {
      return lists;
    },
    [Symbol.dispose]() {
      clearTimeout(timer);
    },
  };
  if (process.platform !== "linux") return ends;
  const started = performance.now();
  const later = (run: () => void, ms: number) => {
    timer = setTimeout(run, ms);
    timer.unref();
  };
  const list = () => {
    let before: Look;
    try {
      before = look(pid);
    } catch {
      return;
    }
    later(() => {
      let after: Look;
      try {
        after = look(pid);
      } catch {
        return;
      }
      const threads = [...after]
        .map(
          ([tid, thread]) =>
            `  ${tid} ${thread.name}: ${thread.state}, ${thread.ticks - (before.get(tid)?.ticks ?? 0)} ticks in ${span} ms, ${thread.where}`,
        )
        .join("\n");
      if (threads !== said) {
        said = threads;
        const seconds = Math.round((performance.now() - started) / 1000);
        say(`${cmd.join(" ")} (${pid}) has not ended after ${seconds} s. Its threads:\n${threads}`);
      }
      lists++;
      later(list, Math.max(every - span, 0));
    }, span);
  };
  later(list, first);
  return ends;
}
