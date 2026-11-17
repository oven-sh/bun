// Tasks with priorities, deadlines and dependencies on a simulated clock: generators as tasks, timers, locks, channels, a log that is checked
enum State {
  Ready = "ready", Waiting = "waiting", Sleeping = "sleeping", Done = "done", Failed = "failed"
}
type Request = {
  kind: "sleep";
  ms: number
} | {
  kind: "lock";
  lock: Lock
} | {
  kind: "unlock";
  lock: Lock
} | {
  kind: "send";
  channel: Channel<any>;
  value: unknown
} | {
  kind: "receive";
  channel: Channel<any>
} | {
  kind: "spawn";
  body: Body;
  options?: Options
} | {
  kind: "join";
  task: Task
} | {
  kind: "yield"
} | {
  kind: "now"
};
type Body = () => Generator<Request, unknown, any>;
interface Options {
  name?: string;
  priority?: number;
  deadline?: number
}
class Heap<T> {
  readonly #items: T[] = [];
  constructor(private readonly before: (a: T, b: T) => boolean) {
  }
  get size() {
    return this.#items.length;
  }
  peek(): T | undefined {
    return this.#items[0];
  }
  push(item: T) {
    const a = this.#items;
    let i = a.length;
    a.push(item);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!this.before(item, a[up])) break;
      a[i] = a[up];
      i = up;
    }
    a[i] = item;
  }
  pop(): T | undefined {
    const a = this.#items, top = a[0], last = a.pop();
    if (a.length === 0 || last === undefined) return top;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= a.length) break;
      if (c + 1 < a.length && this.before(a[c + 1], a[c])) c++;
      if (!this.before(a[c], last)) break;
      a[i] = a[c];
      i = c;
    }
    a[i] = last;
    return top;
  }
  remove(test: (item: T) => boolean): boolean {
    const at = this.#items.findIndex(test);
    if (at < 0) return false;
    const rest = this.#items.splice(0).filter((_, i) => i !== at);
    for (const r of rest) this.push(r);
    return true;
  }
}
class Lock {
  owner: Task | null = null;
  readonly queue: Task[] = [];
  taken = 0;
  constructor(readonly name: string) {
  }
}
class Channel<T> {
  readonly buffer: T[] = [];
  readonly readers: Task[] = [];
  readonly writers: {
    task: Task;
    value: T
}[] = [];
  sent = 0;
  constructor(readonly capacity: number) {
  }
}
class Task {
  static #next = 1;
  readonly id = Task.#next++;
  state = State.Ready;
  result: unknown;
  error: Error | null = null;
  wake = 0;
  steps = 0;
  readonly joiners: Task[] = [];
  send: unknown = undefined;
  fail: Error | null = null;
  readonly gen: ReturnType<Body>;
  readonly name: string;
  priority: number;
  readonly base: number;
  readonly deadline: number;
  constructor(body: Body, { name, priority = 5, deadline = Infinity }: Options = {}) {
    this.gen = body();
    this.name = name ?? "task" + this.id;
    this.priority = this.base = priority;
    this.deadline = deadline;
  }
  toString() {
    return `${this.name}:${this.state}${this.error ? "(" + this.error.message + ")" : ""}`;
  }
  static reset() {
    Task.#next = 1;
  }
}
class DeadlockError extends Error {
  constructor(readonly tasks: Task[]) {
    super("deadlock of " + tasks.map(t => t.name).join());
    this.name = "DeadlockError";
  }
}
type Entry = [time: number, task: string, what: string];
class Scheduler {
  now = 0;
  switches = 0;
  readonly log: Entry[] = [];
  readonly tasks: Task[] = [];
  #seq = 0;
  readonly #order = new Map<Task, number>();
  readonly #ready = new Heap<Task>((a,
    b) => a.priority !== b.priority ? a.priority < b.priority : a.deadline !== b.deadline ? a.deadline < b.deadline : this.#order.get(a)! < this.#order.get(b)!);
  readonly #asleep = new Heap<Task>((a,
    b) => a.wake !== b.wake ? a.wake < b.wake : a.id < b.id);
  constructor(readonly slice = 8, readonly inherit = true) {
  }
  spawn(body: Body, options?: Options): Task {
    const t = new Task(body, options);
    this.tasks.push(t);
    this.#enqueue(t);
    return t;
  }
  #enqueue(t: Task, send?: unknown) {
    t.state = State.Ready;
    t.send = send;
    this.#order.set(t, ++this.#seq);
    this.#ready.push(t);
  }
  #raise(t: Task, priority: number) {
    if (!this.inherit || t.priority <= priority) return;
    const queued = this.#ready.remove(x => x === t);
    t.priority = priority;
    if (queued) this.#ready.push(t);
    this.log.push([this.now, t.name, "raised to " + priority]);
  }
  #finish(t: Task, state: State.Done | State.Failed) {
    t.state = state;
    for (const j of t.joiners.splice(0)) {
      if (state === State.Failed) j.fail = new Error("joined " + t.name, { cause: t.error });
      this.#enqueue(j, t.result);
    }
    this.log.push([this.now, t.name, state]);
  }
  #handle(t: Task, r: Request): boolean {
    switch (r.kind) {
      case "yield": this.#enqueue(t);
      return false;
      case "now": t.send = this.now;
      return true;
      case "sleep": t.state = State.Sleeping;
      t.wake = this.now + r.ms;
      this.#asleep.push(t);
      return false;
      case "spawn": t.send = this.spawn(r.body, r.options);
      return true;
      case "join": if (r.task.state === State.Done) {
        t.send = r.task.result;
        return true;
      }
      if (r.task.state === State.Failed) {
        t.fail = new Error("joined " + r.task.name, { cause: r.task.error });
        return true;
      }
      t.state = State.Waiting;
      r.task.joiners.push(t);
      return false;
      case "lock": if (!r.lock.owner) {
        r.lock.owner = t;
        r.lock.taken++;
        return true;
      }
      t.state = State.Waiting;
      r.lock.queue.push(t);
      this.#raise(r.lock.owner, t.priority);
      return false;
      case "unlock": {
        if (r.lock.owner !== t) {
          t.fail = new TypeError(t.name + " does not hold " + r.lock.name);
          return true;
        }
        t.priority = t.base;
        r.lock.queue.sort((a, b) => a.priority - b.priority || a.id - b.id);
        const next = r.lock.queue.shift() ?? null;
        r.lock.owner = next;
        if (next) {
          r.lock.taken++;
          this.#enqueue(next);
        }
        return true;
      }
      case "send": {
        const {
          channel, value
      } = r;
        channel.sent++;
        const reader = channel.readers.shift();
        if (reader) {
          this.#enqueue(reader, value);
          return true;
        }
        if (channel.buffer.length < channel.capacity) {
          channel.buffer.push(value);
          return true;
        }
        t.state = State.Waiting;
        channel.writers.push({ task: t, value });
        return false;
      }
      case "receive": {
        const {
          channel
      } = r;
        if (channel.buffer.length) {
          t.send = channel.buffer.shift();
          const w = channel.writers.shift();
          if (w) {
            channel.buffer.push(w.value);
            this.#enqueue(w.task);
          }
          return true;
        }
        const w = channel.writers.shift();
        if (w) {
          t.send = w.value;
          this.#enqueue(w.task);
          return true;
        }
        t.state = State.Waiting;
        channel.readers.push(t);
        return false;
      }
      default: {
        const never: never = r;
        throw new TypeError("request " + JSON.stringify(never));
      }
    }
  }
  #step(t: Task) {
    this.switches++;
    for (let n = 0; n < this.slice; n++) {
      t.steps++;
      this.now++;
      let result: IteratorResult<Request, unknown>;
      try {
        if (t.fail) {
          const f = t.fail;
          t.fail = null;
          result = t.gen.throw(f);
      } else {
          const s = t.send;
          t.send = undefined;
          result = t.gen.next(s);
        }
    } catch (e) {
        t.error = e as Error;
        this.#finish(t, State.Failed);
        return;
      }
      if (result.done) {
        t.result = result.value;
        this.#finish(t, State.Done);
        return;
      }
      if (!this.#handle(t, result.value)) return;
    }
    this.#enqueue(t, t.send);
  }
  run(limit = 1e6): this {
    for (;;) {
      while (this.#asleep.size &&
        this.#asleep.peek()!.wake <= this.now) this.#enqueue(this.#asleep.pop()!);
      const t = this.#ready.pop();
      if (t) {
        if (this.now > limit) throw new RangeError("over the limit");
        if (this.now > t.deadline && t.steps === 0) {
          t.error = new RangeError("missed " + t.deadline);
          this.#finish(t, State.Failed);
          continue;
        }
        this.#step(t);
        continue;
      }
      if (this.#asleep.size) {
        this.now = this.#asleep.peek()!.wake;
        continue;
      }
      const stuck = this.tasks.filter(x => x.state === State.Waiting);
      if (stuck.length) throw new DeadlockError(stuck);
      return this;
    }
  }
}
namespace Ask {
  export const sleep = (ms: number): Request => ({ kind: "sleep", ms });
  export const pause: Request = {
    kind: "yield"
};
  export function* locked<T>(lock: Lock, work: () => Generator<Request, T,
    any>): Generator<Request, T, any> {
    yield {
      kind: "lock", lock
  };
    try {
      return yield* work();
  } finally {
      yield {
        kind: "unlock", lock
    };
    }
  }
  export function* all(tasks: Task[]): Generator<Request, unknown[], any> {
    const out: unknown[] = [];
    for (const task of tasks) out.push(yield { kind: "join", task });
    return out;
  }
}
function pipeline(workers: number, items: number, slice: number) {
  Task.reset();
  const s = new Scheduler(slice);
  const input = new Channel<number>(3), output = new Channel<[number, number]>(2);
  const lock = new Lock("sum");
  let sum = 0;
  s.spawn(function* () {
    for (let i = 0; i < items; i++) yield {
      kind: "send", channel: input, value: i
  };
    for (let w = 0; w < workers; w++) yield {
      kind: "send", channel: input, value: -1
  };
    return "sent";
}, { name: "source", priority: 4 });
  const all: Task[] = [];
  for (let w = 0; w < workers; w++) all.push(s.spawn(function* () {
    let n = 0;
    for (;;) {
      const v: number = yield {
        kind: "receive", channel: input
    };
      if (v < 0) return n;
      if (v % 7 === w) yield Ask.sleep(v % 5);
      for (let k = 0; k < v % 4; k++) yield Ask.pause;
      yield {
        kind: "send", channel: output, value: [w, v * v]
    };
      n++;
    }
}, { name: "worker" + w, priority: 3 + (w % 3) }));
  s.spawn(function* () {
    for (let i = 0; i < items; i++) {
      const [w, v]: [number, number] = yield {
        kind: "receive", channel: output
    };
      yield* Ask.locked(lock, function* () {
        const before = sum;
        if (w === 1) yield Ask.pause;
        sum = before + v;
    });
    }
}, { name: "sink", priority: 6 });
  const total = s.spawn(function* () {
    const counts: unknown[] = yield* Ask.all(all);
    return (counts as number[]).reduce((a, b) => a + b, 0);
}, { name: "total" });
  s.run(1e7);
  return [workers, items, sum, total.result, s.now, s.switches, lock.taken, input.sent,
    s.tasks.map(t => t.steps).join("/")].join(" ");
}
for (const [w, n, slice] of [[2, 50, 1], [3, 400, 4], [5, 3000,
  8]] as const) console.log(pipeline(w, n, slice));
function inversion(inherit: boolean) {
  Task.reset();
  const s = new Scheduler(2, inherit);
  const lock = new Lock("bus");
  const work = function* (n: number): Generator<Request, void, any> {
    for (let i = 0; i < n; i++) yield Ask.pause;
};
  s.spawn(function* () {
    yield* Ask.locked(lock, () => work(10));
}, { name: "low", priority: 9 });
  s.spawn(function* () {
    yield Ask.sleep(4);
    yield* work(40);
}, { name: "middle", priority: 5 });
  s.spawn(function* () {
    yield Ask.sleep(6);
    yield* Ask.locked(lock, () => work(2));
    return yield {
      kind: "now"
  };
}, { name: "high", priority: 1 });
  s.run();
  return s.log.map(e => e.join(" ")).join("; ");
}
console.log(inversion(true));
console.log(inversion(false));
Task.reset();
const errors = new Scheduler(3);
const a = new Lock("a"), b = new Lock("b");
const failing = errors.spawn(function* () {
  yield Ask.sleep(3);
  throw new RangeError("inside");
}, { name: "failing" });
errors.spawn(function* () {
  try {
    yield {
      kind: "join", task: failing
  };
} catch (e) {
    return (e as Error).message + "<" + ((e as Error).cause as Error).message;
  }
}, { name: "catcher" });
errors.spawn(function* () {
  yield {
    kind: "unlock", lock: a
};
}, { name: "thief" });
errors.spawn(function* () {
  yield Ask.pause;
}, { name: "late", priority: 9, deadline: 2 });
errors.run();
console.log(errors.tasks.join(" "), errors.tasks[1].result);
Task.reset();
const dead = new Scheduler(1);
for (const [x, y, name] of [[a, b, "one"], [b, a, "two"]] as const) dead.spawn(function* () {
  yield {
    kind: "lock", lock: x
};
  yield Ask.pause;
  yield {
    kind: "lock", lock: y
};
}, { name });
try {
  dead.run();
} catch (e) {
  console.log((e as Error).name, (e as Error).message, e instanceof DeadlockError &&
    e.tasks.length);
}
try {
  new Scheduler().spawn(function* () {
    for (;;) yield Ask.pause;
});
  const s = new Scheduler();
  s.spawn(function* () {
    for (;;) yield Ask.pause;
});
  s.run(500);
} catch (e) {
  console.log((e as Error).message);
}
