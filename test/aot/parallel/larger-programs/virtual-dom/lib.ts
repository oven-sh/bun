// Elements as values, components with state and effects, keyed differences applied to a tree of nodes, events that bubble, a renderer to text
export type Key = string | number | null;
export type Child = VNode | string | number | boolean | null | undefined | readonly Child[];
export type Props = Record<string, unknown> & {
  key?: Key
};
export interface VNode {
  readonly type: string | Component<any>;
  readonly props: Props;
  readonly children: readonly VNode[];
  readonly key: Key;
  readonly text?: string
}
export type Component<P> = ((props: P & { children?: readonly VNode[] }) => Child) & {
  label?: string
};
export const TEXT = "#text", FRAGMENT = "#fragment";
export function h<P extends object>(type: string | Component<P>, props: (P & { key?: Key }) | null,
  ...children: Child[]): VNode {
  const {
    key = null, ...rest
} = (props ?? {}) as Props;
  return {
    type, props: rest, key: key as Key, children: flat(children)
};
}
export function flat(children: readonly Child[], out: VNode[] = []): VNode[] {
  for (const c of children) {
    if (c === null || c === undefined || typeof c === "boolean") continue;
    if (Array.isArray(c)) flat(c, out);
    else if (typeof c === "object") out.push(c as VNode);
    else {
      const last = out.at(-1);
      if (last?.type === TEXT && last.key === null) out[out.length - 1] = {
        ...last, text: last.text! + c
    };
      else out.push({ type: TEXT, props: {}, key: null, children: [], text: String(c) });
    }
  }
  return out;
}
export interface DomEvent {
  readonly name: string;
  readonly target: DomNode;
  stopped: boolean;
  detail: unknown;
  path: string[]
}
export class DomNode {
  static made = 0;
  static moves = 0;
  readonly id = ++DomNode.made;
  parent: DomNode | null = null;
  readonly children: DomNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (e: DomEvent) => void>();
  text = "";
  constructor(readonly tag: string) {
  }
  insert(node: DomNode, at: number) {
    if (node.parent) {
      const was = node.parent.children.indexOf(node);
      node.parent.children.splice(was, 1);
      if (node.parent === this && was < at) at--;
      DomNode.moves++;
    }
    this.children.splice(at, 0, node);
    node.parent = this;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  get html(): string {
    if (this.tag === TEXT) return this.text.replace(/[&<>]/g, c => ({ "&": "&amp;",
      "<": "&lt;", ">": "&gt;" })[c]!);
    const inner = this.children.map(c => c.html).join("");
    if (this.tag === FRAGMENT) return inner;
    const attrs = [...this.attributes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k,
      v]) => (v === "" ? " " + k : ` ${k}="${v}"`)).join("");
    return `<${this.tag}${attrs}>${inner}</${this.tag}>`;
  }
  *find(test: (n: DomNode) => boolean): Generator<DomNode> {
    if (test(this)) yield this;
    for (const c of [...this.children]) yield* c.find(test);
  }
  fire(name: string, detail: unknown = null): DomEvent {
    const e: DomEvent = {
      name, target: this, stopped: false, detail, path: []
  };
    for (let at: DomNode | null = this; at && !e.stopped; at = at.parent) {
      e.path.push(at.tag);
      at.listeners.get(name)?.(e);
    }
    return e;
  }
}
export type HookSlot = {
  kind: "state";
  value: any;
  set: (v: any) => void
} | {
  kind: "memo";
  value: any;
  deps: readonly unknown[]
} | {
  kind: "effect";
  deps: readonly unknown[] | null;
  run: (() => void | (() => void)) | null;
  cleanup: void | (() => void)
} | {
  kind: "ref";
  current: any
};
export class Instance {
  readonly hooks: HookSlot[] = [];
  renders = 0;
  vnode: VNode;
  rendered: Mounted[] = [];
  constructor(vnode: VNode, readonly root: Root, readonly depth: number) {
    this.vnode = vnode;
  }
  get label() {
    const t = this.vnode.type as Component<any>;
    return t.label ?? t.name;
  }
}
export interface Mounted {
  vnode: VNode;
  dom: DomNode | null;
  instance: Instance | null;
  children: Mounted[]
}
export namespace Hooks {
  let current: Instance | null = null, at = 0;
  export function within<T>(instance: Instance, work: () => T): T {
    const was = current, wasAt = at;
    current = instance;
    at = 0;
    try {
      return work();
  } finally {
      if (instance.renders > 0 && at !== instance.hooks.length) {
        current = was;
        at = wasAt;
        throw new Error(instance.label + " changed its hooks");
      }
      current = was;
      at = wasAt;
    }
  }
  function slot<S extends HookSlot>(make: (i: Instance) => S): S {
    if (!current) throw new Error("hooks outside of a component");
    const i = at++;
    if (i >= current.hooks.length) current.hooks.push(make(current));
    return current.hooks[i] as S;
  }
  const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length &&
    a.every((x, i) => Object.is(x, b[i]));
  export function useState<T>(initial: T | (() => T)): [T, (v: T | ((old: T) => T)) => void] {
    const s = slot<HookSlot & {
      kind: "state"
    }
    >(instance => {
      const made: HookSlot & {
        kind: "state"
    } = {
        kind: "state", value: typeof initial === "function" ? (initial as () => T)() : initial,
          set: v => {
          const next = typeof v === "function" ? v(made.value) : v;
          if (Object.is(next, made.value)) return;
          made.value = next;
          instance.root.schedule(instance);
        }
    };
      return made;
  });
    return [s.value, s.set];
  }
  export function useMemo<T>(make: () => T, deps: readonly unknown[]): T {
    const s = slot<HookSlot & {
      kind: "memo"
    }
    >(() => ({ kind: "memo", value: make(), deps }));
    if (!same(s.deps, deps)) {
      s.value = make();
      s.deps = deps;
    }
    return s.value;
  }
  export function useEffect(run: () => void | (() => void),
    deps: readonly unknown[] | null = null) {
    const s = slot<HookSlot & {
      kind: "effect"
    }
    >(() => ({ kind: "effect", deps: null, run, cleanup: undefined }));
    if (!s.deps || !deps || !same(s.deps, deps)) {
      s.run = run;
      s.deps = deps ?? [];
    }
  }
  export function useRef<T>(value: T): {
    current: T
  }
  {
    return slot<HookSlot & {
      kind: "ref"
    }
    >(() => ({ kind: "ref", current: value }));
  }
  export const useReducer = <S, A>(reduce: (s: S, a: A) => S, start: S): [S,
    (a: A) => void] => {
    const [s, set] = useState<S>(start);
    return [s, a => set(old => reduce(old, a))];
};
}
export class Root {
  readonly dom = new DomNode(FRAGMENT);
  #mounted: Mounted[] = [];
  readonly #queue = new Set<Instance>();
  readonly #effects: (HookSlot & { kind: "effect" })[] = [];
  patches = 0;
  commits = 0;
  schedule(i: Instance) {
    this.#queue.add(i);
  }
  render(v: Child): this {
    this.#mounted = this.#reconcile(this.dom, this.#mounted, flat([v]), 0);
    this.#commit();
    this.flush();
    return this;
  }
  flush(limit = 50): number {
    let n = 0;
    while (this.#queue.size) {
      if (++n > limit) throw new RangeError("too many renders");
      const list = [...this.#queue].sort((a, b) => a.depth - b.depth);
      this.#queue.clear();
      for (const i of list) {
        const parent = this.#domOf(i.rendered)[0]?.parent ?? this.dom;
        i.rendered = this.#update(i, parent);
      }
      this.#commit();
    }
    return n;
  }
  #commit() {
    this.commits++;
    for (const e of this.#effects.splice(0)) {
      e.cleanup?.();
      e.cleanup = e.run!();
      e.run = null;
    }
  }
  #domOf(list: readonly Mounted[]): DomNode[] {
    return list.flatMap(m => (m.dom ? [m.dom] : this.#domOf(m.instance ? m.instance.rendered : m.children)));
  }
  #run(i: Instance): VNode[] {
    const out = Hooks.within(i, () => (i.vnode.type as Component<any>)({ ...i.vnode.props,
      children: i.vnode.children }));
    i.renders++;
    for (const s of i.hooks) if (s.kind === "effect" && s.run) this.#effects.push(s);
    return flat([out]);
  }
  #update(i: Instance, parent: DomNode): Mounted[] {
    this.#queue.delete(i);
    const first = this.#domOf(i.rendered)[0];
    const at = first ? parent.children.indexOf(first) : parent.children.length;
    return this.#reconcile(parent, i.rendered, this.#run(i), at, i.depth + 1);
  }
  #mount(v: VNode, parent: DomNode, at: number, depth: number): Mounted {
    this.patches++;
    if (typeof v.type === "function") {
      const instance = new Instance(v, this, depth);
      instance.rendered = this.#reconcile(parent, [], this.#run(instance), at, depth + 1);
      return {
        vnode: v, dom: null, instance, children: []
    };
    }
    if (v.type === FRAGMENT) return {
      vnode: v, dom: null, instance: null, children: this.#reconcile(parent, [], v.children,
        at, depth)
  };
    const dom = new DomNode(v.type);
    if (v.type === TEXT) dom.text = v.text!;
    else this.#props(dom, {}, v.props);
    parent.insert(dom, at);
    return {
      vnode: v, dom, instance: null, children: this.#reconcile(dom, [], v.children, 0, depth)
  };
  }
  #unmount(m: Mounted) {
    this.patches++;
    for (const s of m.instance?.hooks ?? []) if (s.kind === "effect") s.cleanup?.();
    if (m.instance) this.#queue.delete(m.instance);
    for (const c of m.instance ? m.instance.rendered : m.children) this.#unmount(c);
    m.dom?.remove();
  }
  #props(dom: DomNode, old: Props, next: Props) {
    for (const k in { ...old, ...next }) {
      const a = old[k], b = next[k];
      if (Object.is(a, b)) continue;
      this.patches++;
      if (k.startsWith("on")) {
        const name = k.slice(2).toLowerCase();
        if (b) dom.listeners.set(name, b as (e: DomEvent) => void);
        else dom.listeners.delete(name);
    } else if (b === undefined || b === null || b === false) dom.attributes.delete(k);
      else dom.attributes.set(k,
        b === true ? "" : typeof b === "object" ? Object.entries(b as object).map(p => p.join(":")).join(";") : String(b));
    }
  }
  #reconcile(parent: DomNode, old: readonly Mounted[], next: readonly VNode[], at: number,
    depth = 0): Mounted[] {
    const keyed = new Map<Key, Mounted>();
    const loose: Mounted[] = [];
    for (const m of old) if (m.vnode.key !== null) keyed.set(m.vnode.key, m);
    else loose.push(m);
    const used = new Set<Mounted>();
    const out: Mounted[] = [];
    let place = at;
    for (const v of next) {
      let m: Mounted | undefined;
      if (v.key !== null) {
        m = keyed.get(v.key);
        if (m && (m.vnode.type !== v.type || used.has(m))) m = undefined;
    } else {
        const i = loose.findIndex(x => x.vnode.type === v.type && !used.has(x));
        if (i >= 0) m = loose[i];
      }
      if (!m) {
        m = this.#mount(v, parent, place, depth);
    } else {
        used.add(m);
        const before = m.vnode;
        m.vnode = v;
        if (m.instance) {
          m.instance.vnode = v;
          if (before.props !== v.props ||
            before.children !== v.children) m.instance.rendered = this.#update(m.instance,
            parent);
      } else if (v.type === TEXT) {
          if (m.dom!.text !== v.text) {
            m.dom!.text = v.text!;
            this.patches++;
          }
      } else if (v.type === FRAGMENT) {
          const first = this.#domOf(m.children)[0];
          m.children = this.#reconcile(parent, m.children, v.children,
            first ? parent.children.indexOf(first) : place, depth);
      } else {
          this.#props(m.dom!, before.props, v.props);
          m.children = this.#reconcile(m.dom!, m.children, v.children, 0, depth);
        }
        for (const d of this.#domOf([m])) {
          if (parent.children[place] !== d) parent.insert(d, place);
          place++;
        }
        out.push(m);
        continue;
      }
      place += this.#domOf([m]).length;
      out.push(m);
    }
    for (const m of old) if (!used.has(m) && !out.includes(m)) this.#unmount(m);
    return out;
  }
}
