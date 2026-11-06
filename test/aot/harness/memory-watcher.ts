// The thread that watches the memory of child processes for ./memory-limit.ts. It has nothing else to do: however busy the thread is that started a child, somebody looks at the child twenty
// times a second. What it finds it writes into memory that it shares with that thread, so a watch answers at once, without a turn of anybody's event loop.
import { availableMemory, describeMemory, processesBelow, residentMemory, type Told } from "./memory-limit";

declare var self: Worker;

type Watched = Extract<Told, { watch: number }> & { isOver: boolean; peak: number };
type Together = Extract<Told, { together: number }> & { waitsUntil: number };

const watched = new Map<number, Watched>();
const groups = new Map<number, Together>();
const isLinux = process.platform === "linux";
const inMB = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MB`;
let timer: Timer | undefined;

/** Only a process that this one started is ever signalled: a number may have gone to somebody else since its process ended. */
function isOurs(pid: number) {
  if (!(pid > 1)) return false;
  if (!isLinux) return true;
  try {
    return (
      Number(/^PPid:\s*(\d+)/m.exec(require("fs").readFileSync(`/proc/${pid}/status`, "utf8"))?.[1]) === process.pid
    );
  } catch {
    return false;
  }
}

function signal({ pid, leadsAGroup }: Watched, name: "SIGKILL" | "SIGTERM") {
  if (!isOurs(pid)) return;
  try {
    process.kill(leadsAGroup ? -pid : pid, name);
  } catch {}
}

/** First what is to be said, then that it is over, then the signal: whoever sees the child end finds all of it. */
function end(each: Watched, held: string) {
  each.isOver = true;
  const text = new TextEncoder().encode(held).subarray(0, each.shared.byteLength - 16);
  new Uint8Array(each.shared, 16).set(text);
  const words = new Int32Array(each.shared, 0, 2);
  words[1] = text.length;
  Atomics.store(words, 0, 1);
  if (!each.asksFirst) return signal(each, "SIGKILL");
  signal(each, "SIGTERM");
  setTimeout(() => signal(each, "SIGKILL"), 1000);
}

const holds = ({ pid, hasChildren }: Watched, field?: string) => {
  let sum = 0;
  for (const each of hasChildren ? processesBelow(pid) : [pid]) sum += residentMemory(each, field);
  return sum;
};

function look() {
  const held = new Map<number, number>();
  const fattest = new Map<number, [Watched, number]>();
  for (const each of watched.values()) {
    if (each.isOver) continue;
    if (each.of === undefined) {
      if (holds(each) > each.limit)
        end(each, describeMemory(each.hasChildren ? (processesBelow(each.pid)[1] ?? each.pid) : each.pid));
      continue;
    }
    // Without the pages of files, which children of one executable share.
    const own = holds(each, isLinux ? "RssAnon" : undefined);
    each.peak = Math.max(each.peak, own);
    new Float64Array(each.shared, 8, 1)[0] = each.peak;
    held.set(each.of, (held.get(each.of) ?? 0) + own);
    if (!(own <= (fattest.get(each.of)?.[1] ?? -1))) fattest.set(each.of, [each, own]);
  }
  for (const [id, group] of groups) {
    const sum = held.get(id) ?? 0;
    new Float64Array(group.shared)[0] = sum;
    const most = fattest.get(id);
    if (!most || performance.now() < group.waitsUntil) continue;
    if (sum <= group.limit && !(isLinux && availableMemory() < group.limit / 7)) continue;
    // The kernel takes a moment to take back what a killed process held.
    group.waitsUntil = performance.now() + 250;
    const members = [...watched.values()].filter(each => each.of === id);
    for (const each of group.ends === "all" ? members : [most[0]])
      if (!each.isOver)
        end(
          each,
          `it held ${inMB(each.peak)} of the ${inMB(sum)} that ${members.length} processes held together, which may hold ${inMB(group.limit)}`,
        );
  }
}

self.onmessage = ({ data }: MessageEvent<Told>) => {
  if ("together" in data) groups.set(data.together, { ...data, waitsUntil: 0 });
  else if ("watch" in data) watched.set(data.watch, { ...data, isOver: false, peak: 0 });
  else watched.delete(data.forget);
  // A process can grow by more than a gigabyte a second.
  if (watched.size) timer ??= setInterval(look, isLinux ? 50 : 1000);
  else timer = void clearInterval(timer);
  if ("forget" in data && !watched.size) for (const group of groups.values()) new Float64Array(group.shared)[0] = 0;
};
