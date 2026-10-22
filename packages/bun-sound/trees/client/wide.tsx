// wide3.tsx = wide.tsx 68e05254 + SCENARIOS 25..27: react's OWN API.
// wide.tsx: THE WIDE TREE: a gate of correctness for a typed react-reconciler, NOT a measure. Each scenario mounts a root of its own, under the legacy root (0) and the
// concurrent root (1), inside a try: a TypeError of ours ends that scenario alone and is printed, so ONE RUN NAMES EVERY MINE. The reference is the same file run plainly on the untouched packages.
import {
  Activity, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense, createContext, createRef, forwardRef, lazy, memo, startTransition, use, useActionState, useCallback, useContext,
  useDebugValue, useDeferredValue, useEffect, useEffectEvent, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState,
  useSyncExternalStore, useTransition, type ReactNode, type Ref,
  Children, cloneElement, createElement, isValidElement, cache, type ReactElement,
} from "react";
import { createPortal, mount2, newContainer, print } from "./host2";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ink-box": { children?: ReactNode; flexDirection?: "row" | "column"; paddingLeft?: number; ref?: Ref<unknown>; id?: string };
      "ink-text": { children?: ReactNode; color?: string; bold?: boolean; ref?: Ref<unknown> };
    }
  }
}

type Say = (line: string) => void;
type UI = ReturnType<typeof mount2>;
const only = process.argv[2] ?? "";
const macrotask = () => new Promise<void>(done => setTimeout(done, 0));
async function settle(ui: UI) { for (let i = 0; i < 8; i++) { await macrotask(); ui.flush(); ui.passive(); } }
const T = ({ children }: { children?: ReactNode }) => <ink-text>{children}</ink-text>;
const scenarios: [string, (tag: 0 | 1, say: Say) => void | Promise<void>][] = [];
const scenario = (name: string, body: (tag: 0 | 1, say: Say) => void | Promise<void>) => { scenarios.push([name, body]); };

scenario("01 two contexts in one component, past a memo that bails out", (tag, say) => {
  const A = createContext("a0"), B = createContext(0), C = createContext<{ deep: number }>({ deep: 0 });
  let twos = 0, stills = 0;
  function Two() { twos++; const a = useContext(A), b = useContext(B), c = use(C); return <T>{a}:{b}:{c.deep}</T>; }
  const Still = memo(function Still() { stills++; return <ink-box><Two /><A.Consumer>{v => <T>{v}!</T>}</A.Consumer></ink-box>; });
  const App = ({ a, b, c }: { a: string; b: number; c: number }) => { const held = useMemo(() => ({ deep: c }), [c]); return <A value={a}><B.Provider value={b}><C value={held}><Still /></C></B.Provider></A>; };
  const ui = mount2(<App a="a1" b={1} c={1} />, tag, say); say(ui.show());
  for (const [a, b, c] of [["a1", 2, 1], ["a2", 2, 1], ["a2", 2, 2], ["a2", 2, 2], ["a3", 3, 3]] as const) { ui.render(<App a={a} b={b} c={c} />); say(ui.show() + " twos " + twos + " stills " + stills); }
});

scenario("02 useReducer: many dispatches, one batch, a dispatch that changes nothing", (tag, say) => {
  const h: { dispatch?: (a: number | "same") => void } = {};
  let renders = 0;
  function Counter() { renders++; const [n, dispatch] = useReducer((s: number, a: number | "same") => (a === "same" ? s : s + a), 1, x => x * 10); useLayoutEffect(() => { h.dispatch = dispatch; }); return <T>{n}</T>; }
  const ui = mount2(<Counter />, tag, say); say(ui.show());
  ui.sync(() => h.dispatch!(1)); say(ui.show());
  ui.sync(() => { h.dispatch!(2); h.dispatch!(3); h.dispatch!("same"); h.dispatch!(4); }); say(ui.show());
  ui.sync(() => h.dispatch!("same")); ui.sync(() => h.dispatch!("same")); say(ui.show() + " renders " + renders);
});

scenario("03 a class component: setState in its forms, forceUpdate, the whole life cycle", (tag, say) => {
  const Theme = createContext("dark");
  class Full extends Component<{ step: number }, { n: number; from: number; extra?: string }> {
    static contextType = Theme; declare context: string;
    static defaultProps = { step: 1 };
    static getDerivedStateFromProps(props: { step: number }, state: { from: number }) { return props.step !== state.from ? { from: props.step } : null; }
    state = { n: 0, from: -1 } as { n: number; from: number; extra?: string };
    componentDidMount() { say("didMount " + this.state.n); }
    shouldComponentUpdate(_p: unknown, next: { n: number }) { return next.n !== 3; }
    getSnapshotBeforeUpdate(_p: unknown, prev: { n: number }) { return "was " + prev.n; }
    componentDidUpdate(_p: unknown, _s: unknown, snapshot: string) { say("didUpdate " + snapshot + " now " + this.state.n); }
    componentWillUnmount() { say("willUnmount"); }
    render() { return <T>{this.context}:{this.state.n}:{this.state.from}:{this.state.extra ?? "-"}</T>; }
  }
  const ref = createRef<Full>();
  const ui = mount2(<Theme value="light"><Full ref={ref} step={1} /></Theme>, tag, say); say(ui.show());
  ui.sync(() => ref.current!.setState({ n: 1 })); say(ui.show());
  ui.sync(() => { ref.current!.setState(s => ({ n: s.n + 1 })); ref.current!.setState(s => ({ n: s.n + 1 }), () => say("callback " + ref.current!.state.n)); }); say(ui.show());
  ui.sync(() => ref.current!.setState({ n: 4, extra: "x" })); say(ui.show());
  ui.sync(() => ref.current!.forceUpdate(() => say("forced"))); say(ui.show());
  ui.sync(() => ref.current!.setState(null)); ui.render(<Theme value="dim"><Full ref={ref} step={2} /></Theme>); say(ui.show());
  ui.render(null); say(ui.show() + " ref " + String(ref.current));
});

scenario("04 PureComponent, and a class without state", (tag, say) => {
  let pures = 0;
  class Pure extends PureComponent<{ a: number; o: object }> { render() { pures++; return <T>{this.props.a}</T>; } }
  class Bare extends Component<{ children?: ReactNode }> { render() { return <ink-box>{this.props.children}</ink-box>; } }
  const o = {}; const ui = mount2(<Bare><Pure a={1} o={o} /></Bare>, tag, say);
  ui.render(<Bare><Pure a={1} o={o} /></Bare>); ui.render(<Bare><Pure a={2} o={o} /></Bare>); ui.render(<Bare><Pure a={2} o={{}} /></Bare>); say(ui.show() + " pures " + pures);
});

scenario("05 memo with a comparer and without, rendered again and again", (tag, say) => {
  let plain = 0, compared = 0, classy = 0;
  const Plain = memo(function Plain({ v }: { v: number }) { plain++; return <T>{v}</T>; });
  const Compared = memo(function Compared({ v }: { v: number }) { compared++; return <T>{v}</T>; }, (a, b) => (a.v >> 1) === (b.v >> 1));
  const Classy = memo(class extends Component<{ v: number }> { render() { classy++; return <T>{this.props.v}</T>; } });
  const Twice = memo(memo(function Twice({ v }: { v: number }) { return <T>t{v}</T>; }));
  const App = ({ v }: { v: number }) => <ink-box><Plain v={v} /><Compared v={v} /><Classy v={v} /><Twice v={v} /></ink-box>;
  const ui = mount2(<App v={0} />, tag, say);
  for (const v of [0, 1, 2, 2, 3, 4]) { ui.render(<App v={v} />); say(ui.show() + " " + plain + " " + compared + " " + classy); }
});

scenario("06 an error boundary: thrown in render, caught, recovered, thrown again", (tag, say) => {
  class Boundary extends Component<{ children?: ReactNode; name: string }, { error: string | null }> {
    state = { error: null as string | null };
    static getDerivedStateFromError(e: Error) { return { error: e.message }; }
    componentDidCatch(e: Error, info: { componentStack?: string | null }) { say(this.props.name + " didCatch " + e.message + " stack " + typeof info.componentStack); }
    render() { return this.state.error !== null ? <T>caught {this.state.error}</T> : this.props.children; }
  }
  const Bomb = ({ armed }: { armed: string | null }) => { if (armed !== null) throw new Error(armed); return <T>calm</T>; };
  const ref = createRef<Boundary>();
  const ui = mount2(<Boundary name="outer"><Boundary name="inner" ref={ref}><Bomb armed={null} /></Boundary></Boundary>, tag, say); say(ui.show());
  ui.render(<Boundary name="outer"><Boundary name="inner" ref={ref}><Bomb armed="one" /></Boundary></Boundary>); say(ui.show());
  ui.render(<Boundary name="outer"><Boundary name="inner" ref={ref}><Bomb armed={null} /></Boundary></Boundary>); ui.sync(() => ref.current!.setState({ error: null })); say(ui.show());
  ui.render(<Boundary name="outer"><Bomb armed="two" /></Boundary>); say(ui.show());
});

scenario("07 errors in effects, in a ref, in unmounting; and one nobody catches", async (tag, say) => {
  class Boundary extends Component<{ children?: ReactNode }, { error: string | null }> { state = { error: null as string | null }; static getDerivedStateFromError(e: Error) { return { error: e.message }; } render() { return this.state.error !== null ? <T>caught {this.state.error}</T> : this.props.children; } }
  const InLayout = () => { useLayoutEffect(() => { throw new Error("layout"); }, []); return <T>l</T>; };
  const InPassive = () => { useEffect(() => { throw new Error("passive"); }, []); return <T>p</T>; };
  const InCleanup = () => { useEffect(() => () => { throw new Error("cleanup"); }, []); return <T>c</T>; };
  for (const [name, el] of [["layout", <InLayout />], ["passive", <InPassive />]] as const) { const ui = mount2(<Boundary>{el}</Boundary>, tag, say); await settle(ui); say(name + " " + ui.show()); }
  const ui = mount2(<Boundary><InCleanup /></Boundary>, tag, say); await settle(ui); ui.render(<Boundary><T>gone</T></Boundary>); await settle(ui); say("cleanup " + ui.show());
  const Naked = () => { throw new Error("naked"); };
  try { const bare = mount2(<Naked />, tag, say); await settle(bare); say("naked " + bare.show()); } catch (e) { say("naked threw " + (e as Error).message); }
});

scenario("08 Suspense: a thrown promise through use(), the fallback, the retry, hidden and shown again", async (tag, say) => {
  const gates: Record<string, { promise: Promise<string>; open: (v: string) => void }> = {};
  const gate = (k: string) => gates[k] ??= (() => { let open!: (v: string) => void; const promise = new Promise<string>(r => { open = r; }); return { promise, open }; })();
  const Waits = ({ k }: { k: string }) => <T>{use(gate(k).promise)}</T>;
  const Beside = () => { const [n] = useState(7); useLayoutEffect(() => { say("beside layout on"); return () => say("beside layout off"); }, []); return <ink-box id="beside"><T>{n}</T></ink-box>; };
  const App = ({ k }: { k: string }) => <Suspense fallback={<T>wait {k}</T>}><Beside /><Waits k={k} /></Suspense>;
  const ui = mount2(<App k="a" />, tag, say); say(ui.show());
  gate("a").open("A"); await settle(ui); say(ui.show());
  ui.render(<App k="b" />); say(ui.show()); gate("b").open("B"); await settle(ui); say(ui.show());
  ui.render(<App k="a" />); await settle(ui); say(ui.show());
});

scenario("09 lazy, nested Suspense, two that wait at once", async (tag, say) => {
  let load!: (m: { default: (p: { v: number }) => ReactNode }) => void;
  const Lazy = lazy(() => new Promise<{ default: (p: { v: number }) => ReactNode }>(r => { load = r; }));
  let openInner!: (v: string) => void; const inner = new Promise<string>(r => { openInner = r; });
  const Inner = () => <T>{use(inner)}</T>;
  const ui = mount2(<Suspense fallback={<T>outer</T>}><Lazy v={1} /><Suspense fallback={<T>inner</T>}><Inner /></Suspense></Suspense>, tag, say); say(ui.show());
  load({ default: ({ v }) => <T>lazy {v}</T> }); await settle(ui); say(ui.show());
  openInner("in"); await settle(ui); say(ui.show());
});

scenario("10 a portal: into another container, moved, taken away", (tag, say) => {
  const one = newContainer("one"), two = newContainer("two");
  const Ctx = createContext("outside");
  const Reads = () => <T>{useContext(Ctx)}</T>;
  const App = ({ where, n }: { where: 0 | 1 | 2; n: number }) => <ink-box><T>here {n}</T><Ctx value={"in " + n}>{where === 0 ? null : createPortal(<Reads />, where === 1 ? one : two, "p")}</Ctx></ink-box>;
  const ui = mount2(<App where={1} n={1} />, tag, say);
  for (const [where, n] of [[1, 1], [1, 2], [2, 3], [0, 4], [1, 5]] as const) { ui.render(<App where={where} n={n} />); say(ui.show() + " | " + print(one) + " | " + print(two)); }
});

scenario("11 refs: an object, a function, a function with a cleanup, forwardRef, useImperativeHandle", (tag, say) => {
  const Fancy = forwardRef<{ shout(): string }, { word: string }>(function Fancy({ word }, ref) { useImperativeHandle(ref, () => ({ shout: () => word.toUpperCase() }), [word]); return <T>{word}</T>; });
  const AsProp = ({ ref, word }: { ref?: Ref<unknown>; word: string }) => <ink-text ref={ref}>{word}</ink-text>;
  const object = createRef<unknown>(), fancy = createRef<{ shout(): string }>();
  const App = ({ on, word }: { on: boolean; word: string }) => <ink-box ref={object}>{on ? <ink-text ref={n => { say("function ref " + (n === null ? "null" : "node")); }}>f</ink-text> : null}{on ? <ink-text ref={() => { say("cleanup ref on"); return () => say("cleanup ref off"); }}>c</ink-text> : null}<Fancy ref={fancy} word={word} /><AsProp ref={on ? object : undefined} word={word} /></ink-box>;
  const ui = mount2(<App on word="a" />, tag, say); say(ui.show() + " " + fancy.current!.shout() + " " + (object.current !== null));
  ui.render(<App on word="b" />); say(fancy.current!.shout()); ui.render(<App on={false} word="c" />); say(ui.show() + " " + fancy.current!.shout()); ui.render(null); say(String(fancy.current) + " " + String(object.current));
});

scenario("12 children of every kind: keyed and not, moved, put in, taken out, arrays in arrays, iterables, fragments", (tag, say) => {
  const Item = ({ k }: { k: string }) => { const first = useRef(k); return <T>{k}/{first.current}</T>; };
  const App = ({ keys, odd }: { keys: string[]; odd: ReactNode }) => <ink-box>{keys.map(k => <Item key={k} k={k} />)}<Fragment key="f">{odd}</Fragment>{[["x", null], [false, "y", 3]]}{new Set(["s1", "s2"])}</ink-box>;
  const ui = mount2(<App keys={["a", "b", "c", "d"]} odd={null} />, tag, say); say(ui.show());
  const orders = [["d", "c", "b", "a"], ["a", "e", "c"], ["c"], [], ["f", "g", "c", "h", "a"], ["a", "h", "c", "g", "f", "z"]];
  const odds: ReactNode[] = ["text", 12, 12n, true, <T>el</T>, [<T key="1">k1</T>, <T key="2">k2</T>]];
  orders.forEach((keys, i) => { ui.render(<App keys={keys} odd={odds[i]} />); say(ui.show()); });
  const Unkeyed = ({ n }: { n: number }) => <ink-box>{Array.from({ length: n }, (_, i) => <Item k={"u" + i} />)}</ink-box>;
  ui.render(<Unkeyed n={3} />); ui.render(<Unkeyed n={1} />); ui.render(<Unkeyed n={4} />); say(ui.show());
});

scenario("13 the type or the key changes: all below is made anew", (tag, say) => {
  const Keeps = ({ name }: { name: string }) => { const [born] = useState(name); useEffect(() => () => say("gone " + born), [born]); return <T>{name}/{born}</T>; };
  const Other = ({ name }: { name: string }) => <ink-box><Keeps name={name} /></ink-box>;
  const ui = mount2(<Keeps key="1" name="a" />, tag, say);
  ui.render(<Keeps key="1" name="b" />); say(ui.show()); ui.render(<Keeps key="2" name="c" />); ui.passive(); say(ui.show()); ui.render(<Other name="d" />); ui.passive(); say(ui.show()); ui.render(<T>text</T>); ui.passive(); say(ui.show()); ui.render("bare"); say(ui.show());
});

scenario("14 effects: the three kinds, their order, their dependencies, their cleanups", async (tag, say) => {
  const Kid = ({ name, dep }: { name: string; dep: number }) => {
    useInsertionEffect(() => { say(name + " insertion on " + dep); return () => say(name + " insertion off " + dep); }, [dep]);
    useLayoutEffect(() => { say(name + " layout on " + dep); return () => say(name + " layout off " + dep); }, [dep]);
    useEffect(() => { say(name + " passive on " + dep); return () => say(name + " passive off " + dep); }, [dep]);
    useEffect(() => { say(name + " every"); });
    return <T>{name}{dep}</T>;
  };
  const App = ({ dep, both }: { dep: number; both: boolean }) => <ink-box><Kid name="a" dep={dep} />{both ? <Kid name="b" dep={1} /> : null}</ink-box>;
  const ui = mount2(<App dep={1} both />, tag, say); await settle(ui);
  for (const [dep, both] of [[1, true], [2, true], [2, false]] as const) { say("-- " + dep + " " + both); ui.render(<App dep={dep} both={both} />); await settle(ui); }
  say("-- unmount"); ui.render(null); await settle(ui);
});

scenario("15 the small hooks: useMemo useCallback useRef useId useDebugValue, state set while rendering", (tag, say) => {
  let made = 0;
  function useDoubled(n: number) { useDebugValue(n); return useMemo(() => { made++; return n * 2; }, [n]); }
  const h: { set?: (n: number) => void; last?: () => number } = {};
  const App = ({ cap }: { cap: number }) => {
    const [n, set] = useState(0); const [seenCap, setSeenCap] = useState(cap); const count = useRef(0); count.current++;
    if (seenCap !== cap) { setSeenCap(cap); set(0); }
    if (n > cap) set(cap);
    const doubled = useDoubled(n), id = useId(), other = useId(); const get = useCallback(() => n, [n]); h.set = set; const same = h.last === get; h.last = get;
    return <T>{n}:{doubled}:{String(id !== other)}:{String(same)}</T>;
  };
  const ui = mount2(<App cap={3} />, tag, say); say(ui.show());
  for (const n of [1, 1, 2, 9]) { ui.sync(() => h.set!(n)); say(ui.show() + " made " + made); }
  ui.render(<App cap={5} />); say(ui.show());
});

scenario("16 useState: an updater, the same value twice, many setters in one batch, a lazy start", (tag, say) => {
  const h: { a?: (f: number | ((n: number) => number)) => void; b?: (s: string) => void } = {}; let renders = 0;
  const App = () => { renders++; const [a, setA] = useState(() => 5); const [b, setB] = useState("x"); h.a = setA; h.b = setB; return <T>{a}{b}</T>; };
  const ui = mount2(<App />, tag, say);
  ui.sync(() => { h.a!(n => n + 1); h.a!(n => n * 2); h.b!("y"); }); say(ui.show() + " " + renders);
  ui.sync(() => h.a!(12)); ui.sync(() => h.a!(12)); ui.sync(() => h.b!("y")); say(ui.show() + " " + renders);
  ui.batched(() => { h.a!(1); h.b!("z"); }); ui.flush(); say(ui.show() + " " + renders);
});

scenario("17 a transition beside an urgent update: updates are skipped and rebased, in a hook and in a class", async (tag, say) => {
  const h: { set?: (f: (s: string) => string) => void; start?: (f: () => void) => void } = {};
  class Klass extends Component<object, { s: string }> { state = { s: "" }; render() { return <T>k{this.state.s}</T>; } }
  const ref = createRef<Klass>();
  const App = () => { const [s, set] = useState(""); const [pending, start] = useTransition(); h.set = set; h.start = start; return <ink-box><T>h{s}{pending ? "?" : ""}</T><Klass ref={ref} /></ink-box>; };
  const ui = mount2(<App />, tag, say);
  h.start!(() => { h.set!(s => s + "A"); ref.current!.setState(s => ({ s: s.s + "A" })); });
  ui.sync(() => { h.set!(s => s + "b"); ref.current!.setState(s => ({ s: s.s + "b" })); }); say("urgent first: " + ui.show());
  await settle(ui); say("then all: " + ui.show());
  startTransition(() => { h.set!(s => s + "C"); }); startTransition(() => { ref.current!.setState({ s: "D" }); }); await settle(ui); say(ui.show());
});

scenario("18 useDeferredValue, with a first value and without", async (tag, say) => {
  const App = ({ v }: { v: string }) => { const late = useDeferredValue(v), first = useDeferredValue(v, "init"); return <T>{v}/{late}/{first}</T>; };
  const ui = mount2(<App v="a" />, tag, say); say(ui.show()); await settle(ui); say(ui.show()); ui.render(<App v="b" />); say(ui.show()); await settle(ui); say(ui.show());
});

scenario("19 useSyncExternalStore: it changes, it changes while rendering, the subscription changes", async (tag, say) => {
  const store = (v: number) => { let value = v; const subs = new Set<() => void>(); return { get: () => value, set(n: number) { value = n; subs.forEach(f => f()); }, sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; }, size: () => subs.size }; };
  const one = store(1), two = store(100);
  const App = ({ which }: { which: typeof one }) => <T>{useSyncExternalStore(which.sub, which.get, which.get)}</T>;
  const ui = mount2(<App which={one} />, tag, say); await settle(ui); say(ui.show());
  one.set(2); await settle(ui); say(ui.show()); ui.sync(() => one.set(3)); say(ui.show());
  ui.render(<App which={two} />); await settle(ui); say(ui.show() + " " + one.size() + " " + two.size()); two.set(101); one.set(4); await settle(ui); say(ui.show());
});

scenario("20 useOptimistic and useActionState", async (tag, say) => {
  const h: { like?: () => void; act?: (n: number) => void } = {}; let release!: () => void;
  const App = () => {
    const [likes, setLikes] = useState(0); const [shown, addOptimistic] = useOptimistic(likes, (s: number, by: number) => s + by);
    const [total, act, busy] = useActionState(async (s: number, n: number) => { await macrotask(); return s + n; }, 0);
    h.like = () => startTransition(async () => { addOptimistic(1); await new Promise<void>(r => { release = r; }); setLikes(n => n + 1); });
    h.act = n => startTransition(() => act(n));
    return <T>{likes}/{shown}/{total}{busy ? "?" : ""}</T>;
  };
  const ui = mount2(<App />, tag, say); say(ui.show());
  h.like!(); await settle(ui); say("optimistic " + ui.show()); release(); await settle(ui); say("settled " + ui.show());
  h.act!(5); await settle(ui); h.act!(6); await settle(ui); say("acted " + ui.show());
});

scenario("21 Activity: hidden, shown, hidden again; its effects go and come", async (tag, say) => {
  const Kid = () => { const [n, set] = useState(0); useEffect(() => { say("kid on"); return () => say("kid off"); }, []); useLayoutEffect(() => { if (n === 0) set(1); }, [n]); return <ink-box id="kid"><T>{n}</T></ink-box>; };
  const App = ({ mode }: { mode: "visible" | "hidden" }) => <Activity mode={mode}><Kid /></Activity>;
  const ui = mount2(<App mode="hidden" />, tag, say); await settle(ui); say(ui.show());
  for (const mode of ["visible", "hidden", "visible"] as const) { ui.render(<App mode={mode} />); await settle(ui); say(mode + " " + ui.show()); }
});

scenario("22 StrictMode, Profiler, useEffectEvent, a fragment at the root", async (tag, say) => {
  const Kid = ({ v }: { v: number }) => { const latest = useEffectEvent(() => say("event sees " + v)); useEffect(() => { latest(); }, []); useEffect(() => { latest(); }); return <T>{v}</T>; };
  const ui = mount2(<><StrictMode><Profiler id="p" onRender={() => {}}><Kid v={1} /></Profiler></StrictMode><T>tail</T></>, tag, say); await settle(ui); say(ui.show());
  ui.render(<><StrictMode><Profiler id="p" onRender={() => {}}><Kid v={2} /></Profiler></StrictMode><T>tail</T></>); await settle(ui); say(ui.show());
});

scenario("23 an update from an effect, from a layout effect, from a child to its parent, after unmounting", async (tag, say) => {
  const h: { late?: (n: number) => void } = {};
  const Child = ({ up }: { up: (n: number) => void }) => { useLayoutEffect(() => { up(1); }, [up]); useEffect(() => { up(2); }, [up]); return <T>child</T>; };
  const App = () => { const [sum, setSum] = useState(0); const up = useCallback((n: number) => setSum(s => s + n), []); h.late = up; return <ink-box><T>{sum}</T><Child up={up} /></ink-box>; };
  const ui = mount2(<App />, tag, say); say(ui.show()); await settle(ui); say(ui.show()); ui.render(null); h.late!(5); await settle(ui); say(ui.show());
});

scenario("24 the root: rendered later and not at once, twice in a row, emptied, filled again; a deep tree", async (tag, say) => {
  const Deep = ({ n }: { n: number }): ReactNode => (n === 0 ? <T>bottom</T> : <ink-box><Deep n={n - 1} /></ink-box>);
  const ui = mount2(<T>first</T>, tag, say); ui.later(<T>second</T>); ui.later(<T>third</T>); say(ui.show()); await settle(ui); say(ui.show());
  ui.render(null); say(ui.show()); ui.render(<Deep n={40} />); say(String(ui.show().length)); ui.render(<Deep n={3} />); say(ui.show());
});

const typeName = (type: unknown) => (typeof type === "function" ? "fn" : String(type)); // never a function by its text: an audit build has none to print
scenario("25 Children: map, forEach, count, toArray, only; keys that are made", (tag, say) => {
  const kids = (children: ReactNode) => Children.toArray(children).map(c => (isValidElement(c) ? typeName(c.type) + "#" + c.key : typeof c + ":" + String(c))).join(" ");
  const nested: ReactNode = [<T key="a">a</T>, [<T key="b">b</T>, [<T key="c/=:">c</T>, "text", 7, 8n]], null, undefined, true, false, <T>no key</T>, new Set([<T key="s">s</T>]), ""];
  say(kids(nested)); say(String(Children.count(nested))); say(kids(null)); say(kids("one")); say(kids(<T key="k">x</T>)); say(String(Children.count(undefined)) + String(Children.count([])) + String(Children.count([[], [[]]])));
  const seen: string[] = []; (Children.forEach as (c: ReactNode, f: (this: { pre: string }, child: ReactNode, i: number) => void, context: object) => void)(nested, function (child, i) { seen.push(this.pre + i + ":" + (isValidElement(child) ? child.key : String(child))); }, { pre: "@" }); say(seen.join(" "));
  const mapped = Children.map(nested, (child, i) => (i % 3 === 0 ? [child, <T key="extra">+</T>] : i % 3 === 1 ? child : null)); say(kids(mapped)); say(String(Children.map(null, c => c)) + String(Children.map(undefined, c => c)));
  say(kids(Children.map([<T key="x">1</T>, <T key="y">2</T>], c => cloneElement(c as ReactElement, { key: "same" }))));
  say(typeName((Children.only(<T>only</T>) as ReactElement).type)); for (const bad of [[<T key="1" />], "text", null]) try { Children.only(bad as never); say("no throw"); } catch (e) { say("threw " + (e as Error).name); }
  try { Children.toArray({ not: "a child" } as never); say("no throw"); } catch (e) { say("threw " + (e as Error).name); }
  const Wrap = ({ children }: { children?: ReactNode }) => <ink-box>{Children.map(children, (c, i) => <Fragment key={i}><ink-box paddingLeft={i}>{c as ReactNode}</ink-box></Fragment>)}</ink-box>;
  const ui = mount2(<Wrap><T>1</T>{[<T key="p">2</T>, <T key="q">3</T>]}{"four"}{null}</Wrap>, tag, say); say(ui.show()); ui.render(<Wrap>{[<T key="q">3</T>, <T key="p">2</T>]}<T>1</T></Wrap>); say(ui.show());
});

scenario("26 createElement and cloneElement: children by position, defaults, key and ref, what is passed over", (tag, say) => {
  const told = (e: ReactElement) => JSON.stringify({ type: typeof e.type === "string" ? e.type : (e.type as { name?: string }).name, key: e.key, props: e.props }, (_k, v) => (typeof v === "function" ? "fn" : typeof v === "symbol" ? "sym" : isValidElement(v) && _k !== "" ? "<" + typeName((v as ReactElement).type) + ">" : v));
  const D = (props: { a?: number; b?: string; children?: ReactNode }) => <T>{props.a}:{props.b}:{Children.count(props.children)}</T>; (D as { defaultProps?: object }).defaultProps = { a: 1, b: "dflt" };
  say(told(createElement("ink-text"))); say(told(createElement("ink-text", null))); say(told(createElement("ink-text", { color: "1", key: 5 as never, ref: null, __self: 1, __source: 2 } as never, "one")));
  say(told(createElement("ink-box", { id: "i" }, "a", "b", <T key="c">c</T>))); say(told(createElement("ink-box", { children: "from props" } as never))); say(told(createElement("ink-box", { children: "from props" } as never, "wins")));
  say(told(createElement(D))); say(told(createElement(D, { a: undefined, b: null as never }))); say(told(createElement(D, { a: 2 }, 1, 2, 3)));
  const base = createElement("ink-box", { id: "base", paddingLeft: 1, key: "k0" }, "x", "y");
  say(told(cloneElement(base))); say(told(cloneElement(base, null as never))); say(told(cloneElement(base, { paddingLeft: 2 }))); say(told(cloneElement(base, { key: "k1", id: undefined })));
  say(told(cloneElement(base, { key: "key", ref: () => {}, __self: 1, __source: 2 } as never))); say(told(cloneElement(base, { ref: undefined } as never))); say(told(cloneElement(base, {}, "z"))); say(told(cloneElement(base, {}, "p", "q", "r")));
  say(told(cloneElement(createElement(D, { a: 9 }), { a: undefined }))); for (const bad of [null, undefined]) try { cloneElement(bad as never); say("no throw"); } catch (e) { say("threw " + (e as Error).name); }
  say([isValidElement(base), isValidElement({}), isValidElement(null), isValidElement("s"), isValidElement({ $$typeof: Symbol.for("react.transitional.element") })].join());
  const ui = mount2(createElement("ink-box", null, createElement(D), createElement(D, { a: 5 }, "c1", "c2"), cloneElement(base, { paddingLeft: 3 }, createElement(T, null, "in a clone"))), tag, say); say(ui.show());
  ui.render(createElement("ink-box", null, cloneElement(createElement(D, { a: 5, b: "x" }), { b: "y" }))); say(ui.show());
});

scenario("27 what else react itself makes: refs, contexts, lazy, memo, forwardRef, cache, transitions, use", async (tag, say) => {
  const r = createRef<number>(); say(JSON.stringify(r) + Object.keys(r).join()); (r as { current: number | null }).current = 3; say(String(r.current));
  const C = createContext({ n: 1 }); say([typeof C.Provider, typeof C.Consumer, C.Provider === (C as unknown), Object.keys(C).sort().join()].join(" "));
  const M = memo(T), F = forwardRef<unknown, { x: number }>(function Named({ x }, ref) { return <ink-text ref={ref}>{x}</ink-text>; }), L = lazy(async () => ({ default: T }));
  say([M, F, L].map(x => Object.keys(x).sort().join() + ":" + String((x as unknown as { $$typeof: symbol }).$$typeof)).join(" | "));
  const f = cache((a: number, b: object) => ({ a, b })); const o = {}; say(String(f(1, o) === f(1, o)) + typeof f(2, o));
  let order = ""; startTransition(() => { order += "in"; }); order += " out"; say(order); startTransition(async () => { await null; });
  const ui = mount2(<Suspense fallback={<T>f</T>}><C value={{ n: 2 }}><M>memo</M><F x={4} /><L>lazy</L><C.Consumer>{v => <T>{v.n}</T>}</C.Consumer></C></Suspense>, tag, say); say(ui.show()); await settle(ui); say(ui.show());
});

// AT AN ANNOTATED PLACE THE ENGINE COPIES A PLAIN OBJECT INTO THE LAYOUT: an element that untyped react's createElement | cloneElement made is such a stranger where the typed jsx-runtime bears laid-out ones: "A COPY OF AN ELEMENT SOMEBODY ELSE HOLDS WOULD ALSO BREAK IDENTITY: look whether that can be seen".
scenario("28 elements of both makers, held across renders: bail-outs by identity, one element in two places, what a component sees", (tag, say) => {
  const renders: Record<string, number> = {}; const Counted = ({ id, children }: { id: string; children?: ReactNode }) => { renders[id] = (renders[id] ?? 0) + 1; return <ink-text>{id}:{Children.count(children)}</ink-text>; };
  const byJsx = <Counted id="jsx"><T>a</T></Counted>, byCreate = createElement(Counted, { id: "create" }, createElement(T, null, "b")), byClone = cloneElement(byJsx, { id: "clone of jsx" }), byClone2 = cloneElement(byCreate, { id: "clone of create" });
  const held = [byJsx, byCreate, byClone, byClone2]; let bump: (n: number) => void = () => {};
  const Sees = ({ children, want }: { children: ReactNode; want: ReactNode }) => <ink-text>{String(children === want)}:{String(isValidElement(children) && isValidElement(want) && children.props === want.props)}</ink-text>;
  const Parent = () => { const [n, set] = useState(0); bump = set; return <ink-box id={"n" + n}>{byJsx}{byCreate}{byClone}{byClone2}<ink-box>{held.map((e, i) => <Sees key={i} want={e}>{e}</Sees>)}</ink-box></ink-box>; };
  const ui = mount2(<Parent />, tag, say); say(ui.show()); for (const n of [1, 2, 3]) { bump(n); ui.flush(); } say(ui.show()); say(JSON.stringify(renders));
  const Twice = () => <ink-box>{byCreate}<ink-box>{byCreate}{byJsx}</ink-box>{byJsx}</ink-box>; ui.render(<Twice />); say(ui.show()); say(JSON.stringify(renders));
  const keyed = (order: number[]) => <ink-box>{order.map(i => i & 1 ? createElement(Counted, { id: "k" + i, key: i }) : <Counted id={"k" + i} key={i} />)}</ink-box>;
  ui.render(keyed([0, 1, 2, 3])); say(ui.show()); ui.render(keyed([3, 1, 0, 2])); say(ui.show()); ui.render(keyed([1, 4])); say(ui.show()); say(JSON.stringify(renders));
  say(held.map(e => [Object.keys(e).sort().join(), typeof e.type, String(e.key), Object.keys(e.props as object).sort().join()].join("|")).join(" ; "));
});

// EVERY REAL PROGRAM READS JSON, and types it with small records under everyday names: { current }, { pending }, { then }, { value } .. The reconciler's own small records have the same names. A compiler that takes a record for outside data "by its looks" takes theirs too, and through `cursor.current` a Fiber then admits strangers: every read of a Fiber's field is dearer. No answer changes: run.py's `facts` gate is what sees it; this scenario is what gives it something to see.
interface Everyday { a: { current: unknown }; b: { mode: unknown; children: unknown }; c: { cause: unknown }; d: { then: unknown }; e: { pending: unknown }; f: { element: unknown }; g: { destroy: unknown }; h: { cache: unknown }; i: { value: unknown }; j: { set: unknown }; k: { error: unknown }; l: { aborted: unknown; addEventListener: unknown }; m: { pending: unknown; value: unknown; getSnapshot: unknown } }
scenario("29 data from outside under the reconciler's own everyday names, rendered", (tag, say) => {
  const text = '{"a":{"current":1},"b":{"mode":"x","children":[2]},"c":{"cause":3},"d":{"then":4},"e":{"pending":5},"f":{"element":6},"g":{"destroy":7},"h":{"cache":8},"i":{"value":9},"j":{"set":10},"k":{"error":11},"l":{"aborted":false,"addEventListener":12},"m":{"pending":13,"value":14,"getSnapshot":15}}';
  const data = JSON.parse(text) as Everyday;
  const seen = [data.a.current, data.b.mode, data.b.children, data.c.cause, data.d.then, data.e.pending, data.f.element, data.g.destroy, data.h.cache, data.i.value, data.j.set, data.k.error, data.l.aborted, data.l.addEventListener, data.m.pending, data.m.value, data.m.getSnapshot];
  const ui = mount2(<ink-box>{seen.map((x, i) => <T key={i}>{JSON.stringify(x)}</T>)}</ink-box>, tag, say); say(ui.show());
});

for (const [name, body] of scenarios) {
  if (only && !name.startsWith(only)) continue;
  for (const tag of [0, 1] as const) {
    const lines: string[] = [];
    try { await body(tag, line => { lines.push(line); }); } catch (e) { lines.push("THREW " + (e instanceof Error ? e.name + ": " + e.message : String(e))); }
    console.log("== " + name + " [root " + tag + "]"); for (const line of lines) console.log("   " + line);
  }
}
console.log("== the end: " + scenarios.length + " scenarios");
