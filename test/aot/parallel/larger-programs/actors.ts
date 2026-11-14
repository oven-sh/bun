// Actors with mail boxes, supervision, routing, timers on a logical clock, typed messages, persistence by events, a bank and a pipeline that run on them
type Ref<M> = {
  readonly path: string;
  tell(m: M, from?: Ref<any> | null): void;
  readonly alive: boolean
};
type Directive = "resume" | "restart" | "stop" | "escalate";
interface Envelope {
  readonly message: unknown;
  readonly from: Ref<any> | null;
  readonly at: number
}
type Signal = {
  signal: "stopped";
  ref: Ref<any>
} | {
  signal: "timeout";
  key: string
};
class ActorError extends Error {
  constructor(message: string, readonly path: string, options?: ErrorOptions) {
    super(`${path}: ${message}`, options);
    this.name = "ActorError";
  }
}
abstract class Actor<M> {
  context!: Context<M>;
  abstract receive(m: M, from: Ref<any> | null): void;
  started(): void {
  }
  stopped(): void {
  }
  restarted(_: Error): void {
  }
  signal(_: Signal): void {
  }
  supervise(e: Error, _: Ref<any>): Directive {
    return e instanceof RangeError ? "resume" : e instanceof TypeError ? "stop" : "restart";
  }
  protected get self(): Ref<M> {
    return this.context.ref;
  }
}
class Cell<M> {
  readonly ref: Ref<M>;
  readonly box: Envelope[] = [];
  readonly children = new Map<string, Cell<any>>();
  readonly watchers = new Set<Cell<any>>();
  actor: Actor<M>;
  alive = true;
  scheduled = false;
  handled = 0;
  restarts = 0;
  readonly context: Context<M>;
  constructor(readonly system: System, readonly parent: Cell<any> | null,
    readonly name: string, readonly make: () => Actor<M>) {
    const cell = this;
    this.ref = {
      path: (parent ? parent.ref.path + "/" : "") + name, tell(m, from = null) {
        system.deliver(cell, m, from);
    }, get alive() {
        return cell.alive;
      }
  };
    this.context = new Context(this);
    this.actor = make();
    this.actor.context = this.context;
    this.actor.started();
  }
}
class Context<M> {
  readonly #timers = new Map<string, number>();
  behavior: ((m: M, from: Ref<any> | null) => boolean) | null = null;
  readonly stash: Envelope[] = [];
  constructor(readonly cell: Cell<M>) {
  }
  get ref() {
    return this.cell.ref;
  }
  get system() {
    return this.cell.system;
  }
  get now() {
    return this.system.now;
  }
  spawn<N>(name: string, make: () => Actor<N>): Ref<N> {
    if (this.cell.children.has(name)) throw new ActorError("child twice: " + name,
      this.ref.path);
    const c = new Cell<N>(this.system, this.cell, name, make);
    this.cell.children.set(name, c);
    this.system.count++;
    return c.ref;
  }
  stop(child?: string) {
    const c = child === undefined ? this.cell : this.cell.children.get(child);
    if (c) this.system.stop(c);
  }
  watch(ref: Ref<any>) {
    this.system.find(ref.path)?.watchers.add(this.cell);
  }
  become(f: ((m: M, from: Ref<any> | null) => boolean) | null) {
    this.behavior = f;
  }
  keep() {
    if (this.system.current) this.stash.push(this.system.current);
  }
  unstash() {
    this.cell.box.unshift(...this.stash.splice(0));
    this.system.schedule(this.cell);
  }
  timer(key: string, after: number) {
    const id = this.system.timer(this.cell, key, after);
    this.#timers.set(key, id);
  }
  cancel(key: string) {
    const id = this.#timers.get(key);
    if (id !== undefined) this.system.cancel(id);
    return this.#timers.delete(key);
  }
}
class System {
  readonly #queue: Cell<any>[] = [];
  readonly #timers = new Map<number, {
    at: number;
    cell: Cell<any>;
    key: string
  }
  >();
  #nextTimer = 1;
  now = 0;
  count = 0;
  processed = 0;
  dead: string[] = [];
  readonly log: string[] = [];
  current: Envelope | null = null;
  readonly root: Cell<any>;
  constructor(readonly throughput = 5) {
    class Root extends Actor<any> {
      receive() {
      }
      supervise(): Directive {
        return "stop";
      }
    }
    this.root = new Cell<any>(this, null, "", () => new Root());
  }
  spawn<M>(name: string, make: () => Actor<M>): Ref<M> {
    return this.root.context.spawn(name, make);
  }
  find(path: string): Cell<any> | null {
    let c: Cell<any> = this.root;
    for (const p of path.split("/").filter(Boolean)) {
      const next = c.children.get(p);
      if (!next) return null;
      c = next;
    }
    return c;
  }
  deliver(cell: Cell<any>, message: unknown, from: Ref<any> | null) {
    if (!cell.alive) {
      this.dead.push(`${cell.ref.path}<${JSON.stringify(message)}`);
      return;
    }
    cell.box.push({ message, from, at: this.now });
    this.schedule(cell);
  }
  schedule(cell: Cell<any>) {
    if (!cell.scheduled && cell.alive && cell.box.length) {
      cell.scheduled = true;
      this.#queue.push(cell);
    }
  }
  timer(cell: Cell<any>, key: string, after: number): number {
    const id = this.#nextTimer++;
    this.#timers.set(id, { at: this.now + after, cell, key });
    return id;
  }
  cancel(id: number) {
    return this.#timers.delete(id);
  }
  stop(cell: Cell<any>) {
    if (!cell.alive) return;
    for (const c of [...cell.children.values()]) this.stop(c);
    cell.alive = false;
    for (const [id, t] of this.#timers) if (t.cell === cell) this.#timers.delete(id);
    cell.actor.stopped();
    for (const e of cell.box.splice(0)) this.dead.push(`${cell.ref.path}<${JSON.stringify(e.message)}`);
    cell.parent?.children.delete(cell.name);
    for (const w of cell.watchers) if (w.alive) w.actor.signal({ signal: "stopped",
      ref: cell.ref });
    this.log.push("stop " + cell.ref.path);
  }
  #fail(cell: Cell<any>, error: Error, depth = 0): void {
    const parent = cell.parent;
    if (!parent) throw new ActorError("root failed", "", { cause: error });
    const what = parent.actor.supervise(error, cell.ref);
    this.log.push(`${what} ${cell.ref.path} ${error.message}`);
    switch (what) {
      case "resume": return;
      case "restart": {
        for (const c of [...cell.children.values()]) this.stop(c);
        const old = cell.actor;
        cell.restarts++;
        old.stopped();
        cell.context.behavior = null;
        cell.actor = cell.make();
        cell.actor.context = cell.context;
        cell.actor.restarted(error);
        cell.actor.started();
        return;
      }
      case "stop": this.stop(cell);
      return;
      case "escalate": this.#fail(parent, new ActorError("escalated", cell.ref.path,
        { cause: error }), depth + 1);
    }
  }
  #step(cell: Cell<any>) {
    cell.scheduled = false;
    for (let n = 0; n < this.throughput && cell.alive && cell.box.length; n++) {
      const e = cell.box.shift()!;
      this.current = e;
      this.processed++;
      cell.handled++;
      try {
        const b = cell.context.behavior;
        if (!b || !b(e.message as never, e.from)) cell.actor.receive(e.message as never,
          e.from);
    } catch (error) {
        this.#fail(cell, error as Error);
    } finally {
        this.current = null;
      }
    }
    this.schedule(cell);
  }
  run(until = Infinity): this {
    for (;;) {
      while (this.#queue.length) {
        const c = this.#queue.shift()!;
        if (c.alive) this.#step(c);
      }
      let next: [number, { at: number; cell: Cell<any>; key: string }] | null = null;
      for (const t of this.#timers) if (!next || t[1].at < next[1].at ||
        (t[1].at === next[1].at && t[0] < next[0])) next = t;
      if (!next || next[1].at > until) {
        if (until < Infinity) this.now = until;
        return this;
      }
      this.#timers.delete(next[0]);
      this.now = next[1].at;
      try {
        next[1].cell.actor.signal({ signal: "timeout", key: next[1].key });
    } catch (error) {
        this.#fail(next[1].cell, error as Error);
      }
    }
  }
  tree(c: Cell<any> = this.root, depth = 0): string {
    return "  ".repeat(depth) + (c.name ||
      "/") + `(${c.handled})\n` + [...c.children.values()].map(x => this.tree(x,
      depth + 1)).join("");
  }
}
type AccountMessage = {
  kind: "deposit";
  n: number
} | {
  kind: "withdraw";
  n: number;
  reply: Ref<BankMessage>;
  id: number
} | {
  kind: "ask";
  reply: Ref<BankMessage>
} | {
  kind: "freeze"
} | {
  kind: "thaw"
};
type BankMessage = {
  kind: "transfer";
  from: string;
  to: string;
  n: number
} | {
  kind: "taken";
  id: number;
  ok: boolean
} | {
  kind: "balance";
  name: string;
  n: number
} | {
  kind: "open";
  name: string;
  n: number
} | {
  kind: "audit"
} | {
  kind: "freeze";
  name: string;
  ms: number
};
const journal = new Map<string, number[]>();
class Account extends Actor<AccountMessage> {
  #sum = 0;
  readonly #events: number[];
  constructor(readonly name: string) {
    super();
    this.#events = journal.get(name) ?? [];
    journal.set(name, this.#events);
    for (const e of this.#events) this.#sum += e;
  }
  #apply(n: number) {
    this.#events.push(n);
    this.#sum += n;
  }
  receive(m: AccountMessage): void {
    switch (m.kind) {
      case "deposit": if (m.n <= 0) throw new RangeError("deposit " + m.n);
      if (m.n === 13) throw new Error("unlucky");
      this.#apply(m.n);
      break;
      case "withdraw": {
        const ok = this.#sum >= m.n;
        if (ok) this.#apply(-m.n);
        m.reply.tell({ kind: "taken", id: m.id, ok }, this.self);
        break;
      }
      case "ask": m.reply.tell({ kind: "balance", name: this.name, n: this.#sum }, this.self);
      break;
      case "freeze": this.context.become(x => {
        if (x.kind === "thaw") {
          this.context.become(null);
          this.context.unstash();
          return true;
        }
        if (x.kind === "ask") return false;
        this.context.keep();
        return true;
    });
      break;
      case "thaw": break;
    }
  }
  signal(s: Signal) {
    if (s.signal === "timeout") this.self.tell({ kind: "thaw" });
  }
}
class Bank extends Actor<BankMessage> {
  readonly #accounts = new Map<string, Ref<AccountMessage>>();
  readonly #pending = new Map<number, {
    to: string;
    n: number;
    from: string
  }
  >();
  #next = 1;
  done = 0;
  refused = 0;
  readonly balances = new Map<string, number>();
  receive(m: BankMessage): void {
    switch (m.kind) {
      case "open": {
        const ref = this.context.spawn(m.name, () => new Account(m.name));
        this.context.watch(ref);
        this.#accounts.set(m.name, ref);
        ref.tell({ kind: "deposit", n: m.n });
        break;
      }
      case "transfer": {
        const a = this.#accounts.get(m.from);
        if (!a || !this.#accounts.has(m.to)) {
          this.refused++;
          break;
        }
        const id = this.#next++;
        this.#pending.set(id, m);
        a.tell({ kind: "withdraw", n: m.n, reply: this.self, id }, this.self);
        break;
      }
      case "taken": {
        const p = this.#pending.get(m.id)!;
        this.#pending.delete(m.id);
        if (m.ok) {
          this.done++;
          this.#accounts.get(p.to)?.tell({ kind: "deposit", n: p.n }, this.self);
      } else this.refused++;
        break;
      }
      case "balance": this.balances.set(m.name, m.n);
      break;
      case "audit": for (const a of this.#accounts.values()) a.tell({ kind: "ask",
        reply: this.self });
      break;
      case "freeze": {
        const c = this.context.cell.children.get(m.name);
        c?.ref.tell({ kind: "freeze" });
        c?.context.timer("thaw", m.ms);
        break;
      }
    }
  }
  signal(s: Signal) {
    if (s.signal === "stopped") this.#accounts.delete(s.ref.path.split("/").at(-1)!);
  }
  get open() {
    return this.#accounts.size;
  }
}
type Work = {
  item: number
} | {
  done: true
};
class Stage extends Actor<Work> {
  seen = 0;
  constructor(readonly f: (n: number) => number | null, readonly next: Ref<Work> | null) {
    super();
  }
  receive(m: Work) {
    if ("done" in m) {
      this.next?.tell(m, this.self);
      this.context.stop();
      return;
    }
    this.seen++;
    const v = this.f(m.item);
    if (v !== null) this.next?.tell({ item: v }, this.self);
  }
}
class Collector extends Actor<Work> {
  readonly items: number[] = [];
  constructor(readonly parts: number, readonly report: (items: number[]) => void) {
    super();
  }
  #done = 0;
  receive(m: Work) {
    if ("done" in m) {
      if (++this.#done === this.parts) {
        this.report(this.items);
        this.context.stop();
      }
  } else this.items.push(m.item);
  }
}
class Router<M> extends Actor<M> {
  #next = 0;
  constructor(readonly routees: Ref<M>[], readonly all: (m: M) => boolean) {
    super();
  }
  receive(m: M, from: Ref<any> | null) {
    if (this.all(m)) for (const r of this.routees) r.tell(m, from);
    else this.routees[this.#next++ % this.routees.length].tell(m, from);
  }
}
const system = new System(4);
let bank!: Bank;
const bankRef = system.spawn<BankMessage>("bank", () => (bank = new Bank()));
const names = Array.from({ length: 12 }, (_, i) => "acc" + i);
for (const [i, name] of names.entries()) bankRef.tell({ kind: "open", name, n: 1000 + i * 10 });
system.run();
let seed = 17;
const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
for (let i = 0; i < 9000; i++) {
  const r = random(100);
  if (r < 90) bankRef.tell({ kind: "transfer", from: names[random(12)], to: names[random(12)],
    n: 1 + random(200) });
  else if (r < 93) bankRef.tell({ kind: "freeze", name: names[random(12)],
    ms: 5 + random(50) });
  else if (r < 96) system.find("bank/" + names[random(12)])?.ref.tell({ kind: "deposit",
    n: r === 95 ? 13 : -5 });
  else if (r === 99 && i % 500 < 4) bankRef.tell({ kind: "audit" });
  if (i % 50 === 49) system.run(system.now + 20);
}
system.run();
bankRef.tell({ kind: "audit" });
system.run();
console.log(bank.done, bank.refused, bank.open,
  [...bank.balances].map(b => b.join("=")).join(" "), [...bank.balances.values()].reduce((a,
  b) => a + b, 0));
console.log(system.processed, system.now, system.dead.length, system.log.length,
  system.log.slice(0, 3).join("; "),
  [...system.root.children.get("bank")!.children.values()].reduce((s, c) => s + c.restarts, 0),
  [...journal.values()].reduce((s, e) => s + e.length, 0));
console.log(system.tree());
for (const workers of [1, 3]) {
  const s = new System(7);
  let result: number[] = [];
  const collector = s.spawn<Work>("collector", () => new Collector(workers, items => {
    result = items;
}));
  const squares = Array.from({ length: workers }, (_, i) => s.spawn<Work>("square" + i,
    () => new Stage(n => n * n, collector)));
  const router = s.spawn<Work>("router", () => new Router<Work>(squares, m => "done" in m));
  const evens = s.spawn<Work>("evens", () => new Stage(n => {
    if (n === 404) throw new RangeError("no 404");
    return n % 2 ? null : n;
}, router));
  for (let i = 0; i < 4000; i++) evens.tell({ item: i });
  evens.tell({ done: true });
  s.run();
  console.log(workers, result.length, result.reduce((a, b) => (a + b) % 1000003, 0),
    s.processed, s.log.length, s.dead.length, evens.alive, s.log.slice(0, 2).join("; "));
}
const e = new System();
class Child extends Actor<string> {
  receive(m: string) {
    if (m === "type") throw new TypeError("bad type");
    if (m === "deep") throw new SyntaxError("deep");
  }
}
class Parent extends Actor<string> {
  started() {
    this.context.spawn("child", () => new Child());
  }
  receive(m: string) {
    const c = this.context.cell.children.get("child");
    if (c) c.ref.tell(m);
    else this.context.spawn("child", () => new Child());
  }
  supervise(x: Error): Directive {
    return x instanceof SyntaxError ? "escalate" : super.supervise(x, this.self);
  }
}
const p = e.spawn<string>("parent", () => new Parent());
for (const m of ["type", "again", "type", "again", "deep", "after"]) {
  p.tell(m);
  e.run();
}
console.log(e.log.join("; "), e.dead.join(), p.alive);
try {
  e.spawn("parent", () => new Parent());
  e.spawn("parent", () => new Parent());
} catch (x) {
  console.log((x as Error).name, (x as Error).message);
}
