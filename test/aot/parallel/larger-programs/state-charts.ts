// Hierarchical and parallel states with guards, entry and exit actions, history, delayed and eventless transitions, checked by a simulator and printed as a table
type Action<C> = (context: C, event: Event) => Partial<C> | void;
type Guard<C> = (context: C, event: Event) => boolean;
interface Event {
  readonly type: string;
  readonly data?: unknown
}
interface Transition<C> {
  target?: string;
  guard?: Guard<C>;
  actions?: Action<C>[];
  internal?: boolean
}
interface Config<C> {
  initial?: string;
  type?: "atomic" | "compound" | "parallel" | "final" | "history";
  deep?: boolean;
  entry?: Action<C>[];
  exit?: Action<C>[];
  on?: Record<string, Transition<C> | Transition<C>[]>;
  always?: Transition<C>[];
  after?: Record<number, Transition<C>>;
  states?: Record<string, Config<C>>;
  done?: Transition<C>
}
class StateNode<C> {
  readonly children = new Map<string, StateNode<C>>();
  readonly type: NonNullable<Config<C>["type"]>;
  readonly path: string;
  readonly depth: number;
  readonly order: number;
  static #count = 0;
  constructor(readonly name: string, readonly config: Config<C>,
    readonly parent: StateNode<C> | null) {
    this.path = parent ? (parent.parent ? parent.path + "." : "") + name : "";
    this.depth = parent ? parent.depth + 1 : 0;
    this.order = StateNode.#count++;
    this.type = config.type ?? (config.states ? "compound" : "atomic");
    for (const key in config.states) this.children.set(key, new StateNode(key,
      config.states[key], this));
    if (this.type === "compound" &&
      !this.children.has(config.initial ?? "")) throw new TypeError(`${this.path || "the root"} has no initial state`);
  }
  *up(): Generator<StateNode<C>> {
    for (let at: StateNode<C> | null = this; at; at = at.parent) yield at;
  }
  isBelow(other: StateNode<C>) {
    for (const n of this.up()) if (n === other) return true;
    return false;
  }
  find(target: string): StateNode<C> {
    const from: StateNode<C> = target[0] === "#" ? this.#root() : target[0] === "." ? this : this.parent ?? this;
    let at: StateNode<C> = from;
    for (const part of target.replace(/^[#.]/, "").split(".")) {
      const next = at.children.get(part);
      if (!next) throw new ReferenceError(`no state ${target} from ${this.path}`);
      at = next;
    }
    return at;
  }
  #root() {
    let at: StateNode<C> = this;
    while (at.parent) at = at.parent;
    return at;
  }
  transitions(type: string): Transition<C>[] {
    const t = this.config.on?.[type] ?? this.config.on?.["*"];
    return t === undefined ? [] : Array.isArray(t) ? t : [t];
  }
  *all(): Generator<StateNode<C>> {
    yield this;
    for (const c of this.children.values()) yield* c.all();
  }
}
interface Timer<C> {
  at: number;
  node: StateNode<C>;
  transition: Transition<C>;
  seq: number
}
class Machine<C extends object> {
  readonly root: StateNode<C>;
  readonly active = new Set<StateNode<C>>();
  readonly #history = new Map<StateNode<C>, StateNode<C>[]>();
  #timers: Timer<C>[] = [];
  #seq = 0;
  now = 0;
  steps = 0;
  done = false;
  readonly log: string[] = [];
  readonly #queue: Event[] = [];
  #busy = false;
  readonly #watchers = new Set<(m: Machine<C>) => void>();
  constructor(config: Config<C>, public context: C) {
    this.root = new StateNode("root", config, null);
  }
  watch(f: (m: Machine<C>) => void) {
    this.#watchers.add(f);
    return () => this.#watchers.delete(f);
  }
  start(): this {
    this.#enter(this.#initial(this.root), { type: "start" });
    this.#settle({ type: "start" });
    return this;
  }
  get value(): string {
    return [...this.active].filter(n => !n.children.size).map(n => n.path).sort().join(" & ");
  }
  matches(path: string) {
    return [...this.active].some(n => n.path === path);
  }
  #initial(node: StateNode<C>): StateNode<C>[] {
    switch (node.type) {
      case "compound": {
        const child = node.children.get(node.config.initial!)!;
        return [node, ...this.#initial(child)];
      }
      case "parallel": return [node,
        ...[...node.children.values()].filter(c => c.type !== "history").flatMap(c => this.#initial(c))];
      case "history": {
        const kept = this.#history.get(node);
        if (kept?.length) return kept.flatMap(n => (node.config.deep ? [n] : this.#initial(n)));
        return this.#initial(node.parent!).slice(1);
      }
      default: return [node];
    }
  }
  #act(actions: Action<C>[] | undefined, event: Event) {
    for (const a of actions ?? []) {
      const change = a(this.context, event);
      if (change) this.context = {
        ...this.context, ...change
    };
    }
  }
  #enter(nodes: StateNode<C>[], event: Event) {
    for (const n of [...new Set(nodes)].sort((a, b) => a.depth - b.depth ||
      a.order - b.order)) {
      if (this.active.has(n)) continue;
      this.active.add(n);
      if (n.path) this.log.push("+" + n.path);
      this.#act(n.config.entry, event);
      for (const ms in n.config.after) this.#timers.push({ at: this.now + +ms, node: n,
        transition: n.config.after[Number(ms)], seq: this.#seq++ });
      if (n.type === "final") {
        const p = n.parent!;
        if (p === this.root) this.done = true;
        else if (p.config.done) this.#queue.unshift({ type: "done." + p.path });
      }
    }
  }
  #exit(nodes: StateNode<C>[], event: Event) {
    for (const n of nodes.sort((a, b) => b.depth - a.depth || b.order - a.order)) {
      for (const c of n.children.values()) if (c.type === "history") {
        const inside = [...this.active].filter(x => x !== n && x.isBelow(n));
        this.#history.set(c, c.config.deep ? inside : inside.filter(x => x.parent === n));
      }
    }
    for (const n of nodes) {
      this.active.delete(n);
      this.#timers = this.#timers.filter(t => t.node !== n);
      this.log.push("-" + n.path);
      this.#act(n.config.exit, event);
    }
  }
  #take(source: StateNode<C>, t: Transition<C>, event: Event) {
    if (t.target === undefined) {
      this.#act(t.actions, event);
      return;
    }
    const target = source.find(t.target);
    let common: StateNode<C> | null = t.internal &&
      target.isBelow(source) ? source : source.parent;
    while (common && !target.isBelow(common)) common = common.parent;
    const top = common ?? this.root;
    const branch = [...target.up()].find(n => n.parent === top);
    const leaving = [...this.active].filter(n => n !== top && n.isBelow(top) &&
      (top.type !== "parallel" || (branch && n.isBelow(branch))));
    this.#exit(leaving, event);
    this.#act(t.actions, event);
    const path: StateNode<C>[] = [];
    for (const n of target.up()) {
      if (n === top) break;
      path.unshift(n);
    }
    const entering = [...path.slice(0, -1), ...this.#initial(target)];
    for (const n of [...entering]) if (n.type === "parallel") for (const c of n.children.values()) if (c.type !== "history" &&
      !entering.some(x => x.isBelow(c))) entering.push(...this.#initial(c));
    const real = entering.filter(n => n.type !== "history");
    for (const n of [...real]) for (const u of n.up()) {
      if (u === top) break;
      if (!real.includes(u)) real.push(u);
    }
    this.#enter(real, event);
  }
  #select(candidates: (n: StateNode<C>) => Transition<C>[], event: Event): [StateNode<C>,
    Transition<C>][] {
    const out: [StateNode<C>, Transition<C>][] = [];
    const leaves = [...this.active].filter(n => !n.children.size).sort((a,
      b) => a.order - b.order);
    for (const leaf of leaves) for (const n of leaf.up()) {
      const t = candidates(n).find(x => !x.guard || x.guard(this.context, event));
      if (t) {
        if (!out.some(([s, o]) => o === t || (s.isBelow(n) && s !== n))) out.push([n, t]);
        break;
      }
    }
    return out;
  }
  #settle(event: Event) {
    for (let i = 0; i < 100; i++) {
      const found = this.#select(n => n.config.always ?? [], event);
      if (!found.length) {
        const inner = this.#queue.findIndex(e => e.type.startsWith("done."));
        if (inner < 0) return;
        const [e] = this.#queue.splice(inner, 1);
        const node = [...this.active].find(n => "done." + n.path === e.type);
        if (node?.config.done) this.#take(node, node.config.done, e);
        continue;
      }
      for (const [n, t] of found) if (this.active.has(n)) this.#take(n, t, event);
    }
    throw new RangeError("transitions do not end");
  }
  send(type: string, data?: unknown): boolean {
    const e: Event = {
      type, data
  };
    if (this.#busy) {
      this.#queue.push(e);
      return true;
    }
    this.#busy = true;
    let any = false;
    try {
      for (let at: Event | undefined = e; at; at = this.#queue.shift()) {
        if (this.done) break;
        this.steps++;
        const found = this.#select(n => n.transitions(at!.type), at);
        for (const [n, t] of found) if (this.active.has(n) || n === this.root) {
          this.#take(n, t, at);
          any = true;
        }
        this.#settle(at);
      }
  } finally {
      this.#busy = false;
    }
    for (const w of this.#watchers) w(this);
    return any;
  }
  advance(ms: number): number {
    const end = this.now + ms;
    let fired = 0;
    for (;;) {
      const next = this.#timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at ||
        a.seq - b.seq)[0];
      if (!next) break;
      this.now = next.at;
      this.#timers.splice(this.#timers.indexOf(next), 1);
      if (!next.transition.guard || next.transition.guard(this.context, { type: "after" })) {
        fired++;
        this.#take(next.node, next.transition, { type: "after" });
        this.#settle({ type: "after" });
      }
    }
    this.now = end;
    return fired;
  }
  table(): string {
    return [...this.root.all()].filter(n => n.path).map(n => `${"  ".repeat(n.depth - 1)}${n.name}${this.active.has(n) ? "*" : ""} [${n.type}] ${Object.keys(n.config.on ?? {}).join()}`).join("\n");
  }
}
interface Player extends Record<string, unknown> {
  volume: number;
  track: number;
  plays: number;
  errors: string[];
  buffered: number
}
const volume = (by: number): Action<Player> => c => ({ volume: Math.max(0, Math.min(10,
  c.volume + by)) });
const config: Config<Player> = {
  initial: "off", states: {
    off: {
      on: {
        power: {
          target: "on.history"
        }
    }, entry: [c => ({ buffered: 0 })]
  }, on: {
      type: "compound", initial: "idle", on: {
        power: {
          target: "off"
      }, louder: {
          actions: [volume(1)]
      }, quieter: {
          actions: [volume(-1)]
      }, break: {
          target: "broken", actions: [(c, e) => ({ errors: [...c.errors, String(e.data)] })]
        }
    }, states: {
        history: {
          type: "history", deep: true
      }, idle: {
          on: {
            play: [{ target: "running", guard: c => c.track > 0 },
              { actions: [c => ({ track: 1 })], target: "running" }]
          }
      }, running: {
          type: "parallel", on: {
            stop: {
              target: "idle"
            }
        }, states: {
            audio: {
              initial: "buffering", states: {
                buffering: {
                  after: {
                    30: {
                      target: "playing"
                    }
                }, entry: [c => ({ buffered: c.buffered + 1 })]
              }, playing: {
                  entry: [c => ({ plays: c.plays + 1 })], on: {
                    pause: {
                      target: "paused"
                  }, next: {
                      target: "buffering", actions: [c => ({ track: c.track + 1 })]
                    }
                }, always: [{ target: "ended", guard: c => c.track > 12 }], after: {
                    200: {
                      target: "buffering", actions: [c => ({ track: c.track + 1 })]
                    }
                  }
              }, paused: {
                  on: {
                    play: {
                      target: "playing"
                    }
                }, after: {
                    500: {
                      target: "#on.idle"
                    }
                  }
              }, ended: {
                  type: "final"
                }
            }, done: {
                target: "#on.idle", actions: [c => ({ track: 0 })]
              }
          }, light: {
              initial: "dim", states: {
                dim: {
                  on: {
                    touch: {
                      target: "bright"
                    }
                  }
              }, bright: {
                  on: {
                    touch: {
                      target: "dim"
                  }, "*": {
                      actions: []
                    }
                }, after: {
                    120: {
                      target: "dim"
                    }
                  }
                }
              }
            }
          }
        }
      }
  }, broken: {
      on: {
        repair: [{ target: "on.running.light.bright", guard: c => c.errors.length % 2 === 0 },
          { target: "off" }], "*": {
          actions: [(c, e) => (e.type.length > 9 ? { errors: [...c.errors,
            e.type] } : undefined)]
        }
      }
    }
  }
};
for (const seed of [3, 17, 2026]) {
  const m = new Machine<Player>(config, { volume: 5, track: 0, plays: 0, errors: [],
    buffered: 0 }).start();
  let s = seed, changes = 0, mixed = 0;
  const stop = m.watch(x => {
    changes += x.value.length;
});
  const events = ["power", "play", "touch", "next", "pause", "louder", "quieter", "stop",
    "repair", "unknown", "something-long"];
  for (let i = 0; i < 4000; i++) {
    s = (s * 48271) % 2147483647;
    const taken = s % 29 === 0 ? m.send("break", "e" + i) : m.send(events[s % events.length]);
    if (s % 3 === 0) mixed += m.advance(s % 150);
    mixed = (mixed * 31 + m.value.length + (taken ? 1 : 0) + m.context.track) >>> 0;
    if (i < 6 || i === 3999) console.log(seed, i, m.value, m.context.volume, m.context.track,
      m.now);
  }
  stop();
  console.log(mixed, changes, m.steps, m.log.length, m.context.plays, m.context.buffered,
    m.context.errors.length, m.log.slice(0, 12).join(" "));
  if (seed === 3) console.log(m.table(), m.matches("on"), m.done);
}
for (const bad of [{ states: { a: {} } }, { initial: "a",
  states: { a: { on: { x: { target: "nowhere" } } } } }, { initial: "a",
  states: { a: { always: [{ target: "b" }] },
  b: { always: [{ target: "a" }] } } }] as Config<Player>[]) try {
  new Machine<Player>(bad, { volume: 0, track: 0, plays: 0, errors: [],
    buffered: 0 }).start().send("x");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
