// wide.tsx: THE WIDE TREE OF THE SERVER: a gate of correctness for a typed Fizz (react-dom-server.bun.production), NOT a measure. Each scenario renders trees of its own inside a try: a TypeError of ours
// ends that scenario alone and is printed, so ONE RUN NAMES EVERY MINE. The reference is the same file run plainly on the untouched packages. My own writing; wide.tsx is the model.
import {
  Activity, Component, Fragment, PureComponent, StrictMode, Suspense, createContext, forwardRef, lazy, memo, use, useActionState, useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useId,
  useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState, useSyncExternalStore, useTransition, cache, type ReactNode,
  Children, cloneElement, createElement, isValidElement,
} from "react";
import { preconnect, prefetchDNS, preinit, preinitModule, preload, preloadModule, useFormStatus } from "react-dom";
import { renderToPipeableStream, renderToReadableStream, renderToStaticMarkup, renderToString, resume, resumeToPipeableStream, version } from "react-dom/server";
import { prerender, type PostponedState } from "react-dom/static";
import { Writable } from "node:stream";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements { listing: { children?: ReactNode }; math: { children?: ReactNode }; mi: { children?: ReactNode }; mo: { children?: ReactNode }; "my-element": { children?: ReactNode; [name: string]: unknown } }
  }
}

type Say = (line: string) => void;
type Options = NonNullable<Parameters<typeof renderToReadableStream>[1]>;
const only = process.argv[2] ?? "";
// wide.tsx <only> string: EVERY SCENARIO ONCE MORE THROUGH THE LEGACY BUNDLE: what went through renderToReadableStream goes through renderToString, what went through the pipeable stream through renderToStaticMarkup; the steps are not taken (nothing is awaited there: a boundary that suspends gives its fallback).
const legacy = process.argv[3] === "string";
// There a throw IS React's own answer (a component that suspends outside a boundary: error 426; an error in the shell): it is printed as the rendering's text, so that "THREW" stays what no scenario expects.
function answered(render: () => string): string { try { return render(); } catch (e) { return "[the legacy renderer threw: " + told(e) + "]"; } }
// NOTHING IS TIMED BY A CLOCK: a promise is resolved BY HAND, at a step, and a step is taken only when the renderer has fallen quiet (`quiet`: twelve turns of the timer queue).
// `stream(.., ready = true)` reads nothing before allReady: whatever the order of completion, the text is the tree's. `staged` reads from the shell on and marks each step in the text: WHAT WAS FLUSHED BEFORE IT STANDS BEFORE THE MARK.
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function deferred<T>(): Deferred<T> { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); promise.catch(() => {}); return { promise, resolve, reject }; }
const quiet = async () => { for (let i = 0; i < 12; i++) await new Promise<void>(done => setTimeout(done, 1)); };
const soon = <T,>(value: T) => { const d = deferred<T>(); void quiet().then(() => d.resolve(value)); return d.promise; };
const soonFails = (message: string) => { const d = deferred<never>(); void quiet().then(() => d.reject(new Error(message))); return d.promise; };
const scenarios: [string, (say: Say) => void | Promise<void>][] = [];
const scenario = (name: string, body: (say: Say) => void | Promise<void>) => { scenarios.push([name, body]); };
// A TypeError is the ENGINE's (or our compiler's): plain quotes the source's text in its message, an image has none to quote: the class alone is compared; the message goes to stderr, which is shown and not compared.
const told = (e: unknown) => { if (e instanceof TypeError) { console.error("(TypeError: " + e.message + ")"); return "TypeError"; } return e instanceof Error ? e.name + " " + e.message : String(e); };

async function stream(say: Say, node: ReactNode, options: Options = {}, ready = false): Promise<string> {
  if (legacy) return answered(() => renderToString(node, { identifierPrefix: options.identifierPrefix }));
  const s = await renderToReadableStream(node, { onError(e, info) { say("onError " + told(e) + " | " + String(info.componentStack ?? "").trim().split("\n").length + " frames"); return "digest"; }, ...options });
  if (ready) await s.allReady;
  return await new Response(s).text();
}
async function staged(say: Say, node: ReactNode, steps: (() => void)[], options: Options = {}): Promise<string> {
  if (legacy) return answered(() => renderToString(node, { identifierPrefix: options.identifierPrefix }));
  const s = await renderToReadableStream(node, { onError(e) { say("onError " + told(e)); return "digest"; }, ...options });
  const reader = s.getReader(), decoder = new TextDecoder(); let text = "";
  const pump = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) return; text += decoder.decode(value, { stream: true }); } })();
  for (const step of steps) { await quiet(); text += " [STEP] "; step(); }
  await pump; return text;
}
function pipe(say: Say, node: ReactNode, options: Parameters<typeof renderToPipeableStream>[1] = {}, when: "shell" | "all" = "shell", steps: ((abort: (reason: unknown) => void) => void)[] = []): Promise<string> {
  if (legacy) return Promise.resolve().then(() => answered(() => renderToStaticMarkup(node)));
  return new Promise(done => {
    const chunks: string[] = [];
    const sink = new Writable({ write(chunk, _encoding, next) { chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")); next(); }, final(next) { next(); done(chunks.join("")); } });
    const p = renderToPipeableStream(node, {
      onError(e) { say("onError " + told(e)); },
      onShellReady() { say("shell ready"); if (when === "shell") p.pipe(sink); },
      onAllReady() { say("all ready"); if (when === "all") p.pipe(sink); },
      onShellError(e) { say("shell error " + told(e)); done("(no shell)"); },
      ...options,
    });
    void (async () => { for (const step of steps) { await quiet(); chunks.push(" [STEP] "); step(reason => p.abort(reason)); } })();
  });
}

scenario("01 text: escaping, neighbours, numbers, bigints, nothing", async say => {
  say(await stream(say, <div>{"a<b>&\"'c"}{"next"}{1}{2.5}{-0}{10n}{null}{undefined}{true}{false}{""}{"end"}</div>));
  say(await stream(say, <p>{["x", "y", ["z", [1, 2]], null]}{"é中😀"}</p>));
  say(await stream(say, "only text & <tags>"));
  say(await stream(say, <>{"a"}{"b"}<i>c</i>{"d"}</>));
});

scenario("02 attributes of every kind", async say => {
  say(await stream(say, <div id="i" className="a b" title={'q"<&>\''} tabIndex={-1} hidden draggable={false} spellCheck contentEditable="true" suppressContentEditableWarning data-x={1} data-y={true as never} data-z={null as never} aria-hidden aria-label="l" role="note" lang="en" dir="rtl" accessKey="k" />));
  say(await stream(say, <input type="text" value="v" readOnly disabled={false} required autoFocus maxLength={3} size={0 as never} min={0} step="any" multiple={false} checked={false} onChange={() => {}} onClick={() => {}} />));
  say(await stream(say, <a href="javascript:alert(1)" download target="_blank" rel="noopener">x</a>));
  say(await stream(say, <a href="/p?a=1&b=<2>" download="file.txt" hrefLang="de">x</a>));
  say(await stream(say, <img src="/a.png" srcSet="/a.png 1x, /b.png 2x" sizes="100vw" alt="" width={10} height="20" loading="lazy" crossOrigin="anonymous" />));
  say(await stream(say, <video controls muted loop playsInline autoPlay={false} src="/v.mp4" />));
  say(await stream(say, <div {...({ "unknown-attr": "u", unknownCamel: "c", onfoo: "no", "xml:lang": "x", is: "custom", class: "k", for: "f", suppressHydrationWarning: true, key: "k", ref: null } as object)} />));
  say(await stream(say, <label htmlFor="f" {...({ acceptCharset: "utf-8", httpEquiv: "x", formAction: "/x" } as object)} />));
  say(await stream(say, <td colSpan={2} rowSpan={0} headers="h" />));
  say(await stream(say, <ol start={3} reversed><li value={7}>x</li></ol>));
  say(await stream(say, <div {...({ a: Symbol("s"), b: () => 1, c: NaN, d: Infinity, e: {}, f: [1, 2], g: { toString() { return "str"; } } } as object)} />));
});

scenario("03 style", async say => {
  say(await stream(say, <div style={{ color: "red", backgroundColor: "#fff", marginTop: 4, lineHeight: 1.5, zIndex: 3, opacity: 0, WebkitLineClamp: 2, msTransition: "none", flexGrow: 1, width: "10%", content: '"<&>"' } as object} />));
  say(await stream(say, <div style={{ "--custom": 5, "--other-one": "a b", fontSize: 0, padding: "", margin: null, border: undefined, top: false } as object} />));
  say(await stream(say, <div style={{}} />));
  try { say(await stream(say, <div style={"color: red" as never} />)); } catch (e) { say("rejected " + told(e)); }
});

scenario("04 forms: input, select, option, textarea, their defaults and values", async say => {
  say(await stream(say, <form><input defaultValue="d" /><input value="v" defaultValue="d" readOnly /><input type="checkbox" defaultChecked /><input type="radio" checked readOnly value="r" /><input type="number" value={0} readOnly /></form>));
  say(await stream(say, <select defaultValue="b"><option value="a">A</option><option value="b">B</option><optgroup label="g"><option>c</option></optgroup></select>));
  say(await stream(say, <select multiple value={["a", "c"]} onChange={() => {}}><option value="a">A</option><option value="b">B</option><option>c</option><option selected={true}>d</option></select>));
  say(await stream(say, <select value="x y" onChange={() => {}}><option>{"x"} {"y"}</option><option>{1}{2}</option></select>));
  say(await stream(say, <><textarea defaultValue={"line\n<b>"} /><textarea value={"\nleading"} readOnly /><textarea>{"child" as never}</textarea></>));
  say(await stream(say, <><pre>{"\nnewline first"}</pre><listing>{"\nold" as never}</listing><button formAction="/go" name="n" value="v">b</button></>));
  say(await stream(say, <form action="/post" method="post" encType="multipart/form-data"><progress value={0} max={10} /><meter value={0.5} /><output name="o">1</output></form>));
});

scenario("05 function actions on forms, useActionState, useFormStatus, useOptimistic", async say => {
  function Status() { const s = useFormStatus(); return <i>{String(s.pending)}:{String(s.data)}:{String(s.method)}</i>; }
  function F() {
    const [state, action, pending] = useActionState(async (n: number) => n + 1, 5);
    const [optimistic] = useOptimistic(state);
    return <form action={action}><Status /><b>{state}:{optimistic}:{String(pending)}</b><button formAction={() => {}}>x</button><input type="submit" formAction={async () => {}} /></form>;
  }
  say(await stream(say, <F />));
  say(await stream(say, <form action={() => {}}><input name="a" /></form>));
});

scenario("06 void elements, namespaces, custom elements, odd tags", async say => {
  say(await stream(say, <div><br /><hr /><wbr /><input /><img alt="a" /><area /><col /><embed /><source /><track /></div>));
  say(await stream(say, <svg viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="x"><g strokeWidth={2} fillOpacity={0.5} clipPath="url(#c)"><path d="M0 0" /><use xlinkHref="#a" /><foreignObject><div className="h">html</div></foreignObject><text textAnchor="middle">t</text></g></svg>));
  say(await stream(say, <math><mi>x</mi><mo>+</mo></math>));
  say(await stream(say, <my-element {...({ className: "c", someProp: "p", bool: true, off: false, obj: {}, fn() {}, htmlFor: "h" } as object)}>in</my-element>));
  say(await stream(say, <table><caption>c</caption><colgroup><col span={2} /></colgroup><tbody><tr><td>1</td></tr></tbody><tfoot><tr><th scope="row">f</th></tr></tfoot></table>));
  try { say(await stream(say, <br>{"child" as never}</br>)); } catch (e) { say("rejected " + told(e)); }
  try { const Bad = "a b" as never as "div"; say(await stream(say, <Bad />)); } catch (e) { say("rejected " + told(e)); }
  try { const Script = "SCRIPT" as never as "div"; say(await stream(say, <Script />)); } catch (e) { say("rejected " + told(e)); }
});

scenario("07 dangerouslySetInnerHTML", async say => {
  say(await stream(say, <div dangerouslySetInnerHTML={{ __html: "<b>&raw</b>" }} />));
  say(await stream(say, <><script dangerouslySetInnerHTML={{ __html: "if (a < b) c('</script>')" }} /><style dangerouslySetInnerHTML={{ __html: "a > b { c: '</style>' }" }} /></>));
  try { say(await stream(say, <div dangerouslySetInnerHTML={{ __html: "x" }}>{"y"}</div>)); } catch (e) { say("rejected " + told(e)); }
  try { say(await stream(say, <div dangerouslySetInnerHTML={"x" as never} />)); } catch (e) { say("rejected " + told(e)); }
});

scenario("08 components of every kind", async say => {
  const Fn = ({ a = "default", children }: { a?: string; children?: ReactNode }) => <i title={a}>{children}</i>;
  const Memo = memo(Fn), MemoMemo = memo(Memo, () => true);
  const Fwd = forwardRef<HTMLElement, { x: number }>(function Fwd({ x }, ref) { return <b ref={ref}>{x}:{String(ref)}</b>; });
  class Cls extends Component<{ n: number }, { m: number }> { state = { m: this.props.n * 2 }; render() { return <u>{this.props.n}:{this.state.m}</u>; } }
  class Pure extends PureComponent<{ t: string }> { static defaultProps = { t: "dflt" }; render() { return <s>{this.props.t}</s>; } }
  const Null = () => null, Arr = () => [<i key="1">1</i>, "two", 3], Str = () => "str", Num = () => 0, Bool = () => false;
  say(await stream(say, <div><Fn /><Fn a="x">c</Fn><Memo a="m" /><MemoMemo a="mm" /><Fwd x={1} /><Cls n={2} /><Pure /><Pure t="p" /><Null /><Arr /><Str /><Num /><Bool /></div>));
  say(await stream(say, <StrictMode><Fragment key="k"><Fn>{[<Fn key="a" a="in" />]}</Fn></Fragment></StrictMode>));
  try { const Undefined = undefined as unknown as typeof Fn; say(await stream(say, <Undefined />)); } catch (e) { say("rejected " + told(e)); }
  try { const Obj = {} as unknown as typeof Fn; say(await stream(say, <Obj />)); } catch (e) { say("rejected " + told(e)); }
  try { say(await stream(say, <div>{{ not: "a child" } as never}</div>)); } catch (e) { say("rejected " + told(e)); }
  try { say(await stream(say, <div>{(() => 1) as never}{Symbol("s") as never}</div>)); } catch (e) { say("rejected " + told(e)); }
});

scenario("09 a class component's life on the server", async say => {
  const Theme = createContext("dark");
  class Full extends Component<{ step: number }, { n: number; from: number; extra?: string }> {
    static contextType = Theme; declare context: string;
    static getDerivedStateFromProps(props: { step: number }, state: { from: number }) { return props.step !== state.from ? { from: props.step } : null; }
    state = { n: 0, from: -1 } as { n: number; from: number; extra?: string };
    componentDidMount() { say("didMount: NOT DUE ON A SERVER"); }
    render() { return <i>{this.context}:{this.state.n}:{this.state.from}</i>; }
  }
  class Old extends Component<{ a: number }, { n: number; log: string }> {
    state = { n: 1, log: "" };
    UNSAFE_componentWillMount() { this.setState({ n: 2 }); this.setState(s => ({ n: s.n + 10 })); this.setState(null); this.setState((s, p) => ({ log: s.n + ":" + p.a }), () => say("callback: not due")); }
    render() { return <b>{this.state.n}:{this.state.log}</b>; }
  }
  class Replaces extends Component { state = { a: 1 }; UNSAFE_componentWillMount() { this.forceUpdate(); (this as unknown as { updater: { enqueueReplaceState(i: unknown, s: unknown): void } }).updater.enqueueReplaceState(this, { b: 2 }); } render() { return <i>{JSON.stringify(this.state)}</i>; } }
  say(await stream(say, <Theme value="light"><Full step={3} /><Old a={7} /><Replaces /></Theme>));
  class NoRender extends Component { }
  try { say(await stream(say, <NoRender />)); } catch (e) { say("rejected " + told(e)); }
});

scenario("10 contexts: nested, restored, consumers, defaults, beside Suspense", async say => {
  const A = createContext("a0"), B = createContext(0);
  const Show = () => <i>{useContext(A)}:{use(B)}</i>;
  const Slow = ({ p }: { p: Promise<string> }) => <b>{use(p)}<Show /></b>;
  say(await stream(say, <div><Show /><A value="a1"><Show /><B.Provider value={1}><Show /><A.Provider value="a2"><Show /><A.Consumer>{v => <u>{v}</u>}</A.Consumer></A.Provider><Show /></B.Provider><Show /></A><Show /></div>));
  const one = deferred<string>(), two = deferred<string>();
  const tree = () => <A value="outer"><Suspense fallback={<Show />}><B value={5}><Slow p={one.promise} /></B></Suspense><A value="sibling"><Show /></A><Suspense fallback="f2"><A value="inner"><Slow p={two.promise} /></A></Suspense></A>;
  say(await staged(say, tree(), [() => two.resolve("second first"), () => one.resolve("first second")]));
  say(await stream(say, tree(), {}, true));
});

scenario("11 the hooks on a server", async say => {
  const store = { subscribe: () => () => {}, client: () => "client", server: () => "server" };
  function All({ seed }: { seed: number }) {
    const [a, setA] = useState(seed), [b] = useState(() => seed * 2), [c, dispatch] = useReducer((s: number, x: number) => s + x, seed, s => s + 100);
    const r = useRef(7), m = useMemo(() => a + b, [a, b]), cb = useCallback(() => m, [m]), d = useDeferredValue("now", "initial"), [pending, start] = useTransition();
    const id1 = useId(), id2 = useId(), ext = useSyncExternalStore(store.subscribe, store.client, store.server);
    useEffect(() => { say("effect: not due"); }); useLayoutEffect(() => { say("layout effect: not due"); }); useInsertionEffect(() => { say("insertion effect: not due"); });
    useImperativeHandle({ current: null as number | null }, () => 1); useDebugValue("x");
    if (a === seed && seed < 3) { setA(a + 1); dispatch(1); dispatch(2); }
    return <i id={id1} data-two={id2}>{[a, b, c, r.current, m, cb(), d, String(pending), typeof start, ext].join(",")}</i>;
  }
  say(await stream(say, <div><All seed={1} /><All seed={5} /></div>));
  function Loops() { const [n, set] = useState(0); set(n + 1); return <i>{n}</i>; }
  try { say(await stream(say, <Loops />)); } catch (e) { say("rejected " + told(e)); }
  function NoServerSnapshot() { return <i>{useSyncExternalStore(store.subscribe, store.client)}</i>; }
  try { say(await stream(say, <NoServerSnapshot />)); } catch (e) { say("rejected " + told(e)); }
  function Cached() { const f = useMemo(() => cache((x: number) => ({ x })), []); return <i>{String(f(1) === f(1))}</i>; }
  say(await stream(say, <Cached />));
});

scenario("12 useId: deep, in lists, across boundaries, with a prefix", async say => {
  const Id = ({ children }: { children?: ReactNode }) => { const id = useId(); return <i id={id}>{children}</i>; };
  const Two = () => { const a = useId(), b = useId(); return <b id={a} title={b} />; };
  const Slow = ({ p }: { p: Promise<unknown> }) => { use(p); return <Id />; };
  say(await stream(say, <div><Id><Id><Id /></Id><Id /></Id>{[1, 2, 3].map(k => <Id key={k} />)}<Two /><><Id /><Id /></></div>));
  const d = deferred<number>();
  say(await staged(say, <div><Id /><Suspense fallback={<Id />}><Slow p={d.promise} /><Id /></Suspense><Id /></div>, [() => d.resolve(1)], { identifierPrefix: "pre-" }));
  say(await stream(say, <div>{Array.from({ length: 40 }, (_, k) => <Id key={k}>{k % 7 === 0 ? <Id /> : null}</Id>)}</div>));
});

scenario("13 Suspense: what suspends, nested, in order and out of order", async say => {
  const Slow = ({ p, tag }: { p: Promise<string>; tag?: string }) => <b data-tag={tag}>{use(p)}</b>;
  function Text({ p }: { p: Promise<string> }) { return use(p); }
  { const a = deferred<string>(), b = deferred<string>();
    say(await staged(say, <div><Suspense fallback={<i>f1</i>}><Slow p={a.promise} /></Suspense><Suspense fallback={<i>f2</i>}><Slow p={b.promise} /></Suspense>tail</div>, [() => b.resolve("two"), () => a.resolve("one")])); }
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1]]) {
    const d = [deferred<string>(), deferred<string>(), deferred<string>()];
    say(order.join("") + " " + await staged(say, <div><Suspense fallback="outer"><div><Slow p={d[0]!.promise} /><Suspense fallback="inner"><Slow p={d[1]!.promise} /><Suspense fallback="innermost"><Slow p={d[2]!.promise} /></Suspense></Suspense></div></Suspense></div>, order.map(i => () => d[i]!.resolve("abc"[i]!))));
  }
  say(await stream(say, <div><Suspense fallback="f"><Slow p={soon("ready")} /></Suspense></div>, {}, true));
  { const d = deferred<string>(); say(await staged(say, <div><Suspense><Slow p={d.promise} /></Suspense></div>, [() => d.resolve("no fallback")])); }
  say(await stream(say, <div><Slow p={soon("in the shell")} /></div>));
  const done = Promise.resolve("resolved"); await done;
  say(await stream(say, <Suspense fallback="f"><Slow p={done} /><Slow p={Object.assign(Promise.resolve("x"), { status: "fulfilled", value: "tracked" }) as Promise<string>} /></Suspense>, {}, true));
  { const d = deferred<string>(); say(await staged(say, <table><tbody><Suspense fallback={<tr><td>f</td></tr>}><tr><td><Slow p={d.promise} /></td></tr></Suspense></tbody></table>, [() => d.resolve("cell")])); }
  { const d = deferred<string>(); say(await staged(say, <svg><Suspense fallback={<g id="f" />}><g><Slow p={d.promise} /></g></Suspense></svg>, [() => d.resolve("svg")])); }
  { const d = deferred<string>(); say(await staged(say, <select><Suspense fallback={<option>f</option>}><option><Text p={d.promise} /></option></Suspense></select>, [() => d.resolve("opt")])); }
});

scenario("14 lazy, thenables as children, async iterables, promises of nodes", async say => {
  const L = lazy(() => soon({ default: ({ x }: { x: number }) => <i>lazy {x}</i> }));
  const Now = lazy(() => Promise.resolve({ default: () => <i>now</i> }));
  const Bad = lazy(() => soonFails("the chunk did not load") as Promise<{ default: () => ReactNode }>);
  say(await stream(say, <Suspense fallback="f"><L x={1} /><Now /><L x={2} /></Suspense>, {}, true));
  say(await stream(say, <div><Suspense fallback="bad fallback"><Bad /></Suspense></div>, {}, true));
  say(await stream(say, <Suspense fallback="f"><div>{soon(<b>promised node</b>)}{Promise.resolve("promised text")}</div></Suspense>, {}, true));
  say(await stream(say, <ul>{new Set([<li key="a">a</li>, <li key="b">b</li>])}{(function* () { yield <li key="c">c</li>; yield <li key="d">d</li>; })()}</ul>));
  say(await stream(say, <div>{lazy(() => soon({ default: <u>a lazy node</u> as never })) as never}</div>));
  { const d = deferred<{ default: () => ReactNode }>(); const Staged = lazy(() => d.promise); say(await staged(say, <div><Suspense fallback="waiting for the chunk"><Staged /></Suspense></div>, [() => d.resolve({ default: () => <i>the chunk</i> })])); }
});

scenario("15 errors: in the shell, in a boundary, in a fallback, digests", async say => {
  const Throws = ({ m }: { m: string }): ReactNode => { throw new Error(m); };
  const ThrowsLater = ({ p }: { p: Promise<never> }) => <i>{use(p)}</i>;
  try { say(await stream(say, <div><Throws m="in the shell" /></div>)); } catch (e) { say("rejected " + told(e)); }
  say(await stream(say, <div><Suspense fallback={<i>client renders</i>}><Throws m="in a boundary" /></Suspense>after</div>));
  { const d = deferred<never>(); say(await staged(say, <div><Suspense fallback="f"><ThrowsLater p={d.promise} /></Suspense></div>, [() => d.reject(new Error("rejected later"))])); }
  say(await stream(say, <div><Suspense fallback="f"><ThrowsLater p={soonFails("rejected before the flush")} /></Suspense></div>, {}, true));
  try { say(await stream(say, <Suspense fallback={<Throws m="in the fallback" />}><ThrowsLater p={soonFails("and the content")} /></Suspense>, {}, true)); } catch (e) { say("rejected " + told(e)); }
  say(await stream(say, <Suspense fallback="outer f"><Suspense fallback={<Throws m="inner fallback" />}><ThrowsLater p={soonFails("inner content")} /></Suspense></Suspense>, {}, true));
  const Odd = ({ v }: { v: unknown }): ReactNode => { throw v; };
  for (const v of ["a string", 42, null, undefined, { message: "an object" }]) say(await stream(say, <Suspense fallback="f"><Odd v={v} /></Suspense>));
  class Boundary extends Component<{ children: ReactNode }, { e: unknown }> { state = { e: null }; static getDerivedStateFromError(e: unknown) { return { e }; } render() { return this.state.e ? <i>caught</i> : this.props.children; } }
  try { say(await stream(say, <Boundary><Throws m="boundaries do not catch on a server" /></Boundary>)); } catch (e) { say("rejected " + told(e)); }
});

scenario("16 abort: by a signal, by the pipeable stream, before and behind the shell", async say => {
  const Never = () => <i>{use(new Promise<string>(() => {}))}</i>;
  const c1 = new AbortController();
  say(await staged(say, <div>shell<Suspense fallback="waiting"><Never /></Suspense></div>, [() => c1.abort(new Error("signal says stop"))], { signal: c1.signal }));
  const c2 = new AbortController(); c2.abort("already aborted");
  try { say(await stream(say, <div><Never /></div>, { signal: c2.signal })); } catch (e) { say("rejected " + told(e)); }
  const c3 = new AbortController(); void quiet().then(() => c3.abort());
  try { say(await stream(say, <div><Never /></div>, { signal: c3.signal })); } catch (e) { say("rejected " + told(e)); }
  say(await pipe(say, <div>shell<Suspense fallback="w1"><Never /></Suspense><Suspense fallback="w2"><div><Suspense fallback="w3"><Never /></Suspense><Never /></div></Suspense></div>, {}, "shell", [abort => abort(new Error("aborted by the host"))]));
});

scenario("17 the pipeable stream", async say => {
  const Slow = ({ p }: { p: Promise<string> }) => <b>{use(p)}</b>;
  { const d = deferred<string>(); say(await pipe(say, <div>a<Suspense fallback="f"><Slow p={d.promise} /></Suspense></div>, {}, "shell", [() => d.resolve("late")])); }
  say(await pipe(say, <div>a<Suspense fallback="f"><Slow p={soon("late")} /></Suspense></div>, {}, "all"));
  const Throws = (): ReactNode => { throw new Error("shell"); };
  say(await pipe(say, <div><Throws /></div>));
  say(await pipe(say, <html><head><title>t</title></head><body>b</body></html>, { bootstrapScripts: ["/main.js"], nonce: "n0" }));
});

scenario("18 a whole document: head, hoisted title | meta | link, styles by precedence, scripts", async say => {
  const Deep = () => <div><title>deep title</title><meta name="deep" content="1" /><link rel="icon" href="/i.ico" /><link rel="stylesheet" href="/deep.css" precedence="low" /><style href="inline-a" precedence="high">{".a{}"}</style><script async src="/async.js" /><script src="/sync.js" /><script>{"inline()"}</script>in body</div>;
  say(await stream(say, <html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="w" /><link rel="stylesheet" href="/head.css" precedence="high" /><link rel="stylesheet" href="/plain.css" /></head><body className="b"><Deep /><Deep /></body></html>));
  say(await stream(say, <html><body><Deep /></body></html>));
  say(await stream(say, <div><Deep /></div>));
  const Slow = ({ p }: { p: Promise<unknown> }) => { use(p); return <><link rel="stylesheet" href="/late.css" precedence="low" /><style href="late-inline" precedence="new">{".late{}"}</style><title>late</title><p>late content</p></>; };
  { const d = deferred<number>(); say(await staged(say, <html><head /><body><Suspense fallback="f"><Slow p={d.promise} /></Suspense></body></html>, [() => d.resolve(1)])); }
  say(await stream(say, <html><head /><body><Suspense fallback="f"><Slow p={soon(1)} /></Suspense></body></html>, {}, true));
  say(await stream(say, <svg><title>svg title stays</title><style>{".s{}"}</style></svg>));
  say(await stream(say, <noscript><link rel="stylesheet" href="/n.css" precedence="x" /><title>in noscript</title></noscript>));
});

scenario("19 preload, preinit, preconnect and their kin", async say => {
  function Hints() {
    prefetchDNS("https://dns.example"); preconnect("https://c.example"); preconnect("https://cc.example", { crossOrigin: "anonymous" }); preconnect("https://c.example");
    preload("/font.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" }); preload("/img.png", { as: "image", imageSrcSet: "/a 1x", imageSizes: "10px", fetchPriority: "high" }); preload("/s.css", { as: "style" }); preload("/j.js", { as: "script", integrity: "sha" , nonce: "n" }); preload("/x.bin", { as: "fetch" });
    preloadModule("/m.mjs"); preloadModule("/w.mjs", { as: "worker" as never });
    preinit("/init.css", { as: "style", precedence: "p1" }); preinit("/init.css", { as: "style", precedence: "p2" }); preinit("/init.js", { as: "script", crossOrigin: "use-credentials" }); preinitModule("/init.mjs", { as: "script" });
    return <p>hints</p>;
  }
  say(await stream(say, <html><head /><body><Hints /><img src="/hero.png" fetchPriority="high" /><img src="/lazy.png" loading="lazy" /><picture><img src="/in-picture.png" /></picture></body></html>));
  say(await stream(say, <div><Hints /></div>));
  const headers: string[] = [];
  say(await stream(say, <html><body><Hints /></body></html>, { onHeaders(h: Headers) { h.forEach((v, k) => headers.push(k + ": " + v)); }, maxHeadersLength: 300 } as Options));
  say(headers.join(" | "));
});

scenario("20 the options: bootstrap scripts and modules, nonce, import map, prefix, chunk size, namespace", async say => {
  const Slow = ({ p }: { p: Promise<string> }) => <b>{use(p)}</b>;
  const y = deferred<string>();
  say(await staged(say, <div>x<Suspense fallback="f"><Slow p={y.promise} /></Suspense></div>, [() => y.resolve("y")], { bootstrapScriptContent: "boot('</script>')", bootstrapScripts: ["/a.js", { src: "/b.js", integrity: "i", crossOrigin: "anonymous" }], bootstrapModules: ["/m.mjs"], nonce: "N", identifierPrefix: "p" }));
  say(await stream(say, <html><head /><body>x</body></html>, { importMap: { imports: { react: "/react.js" } }, nonce: { script: "S", style: "T" } as never }));
  say(await stream(say, <path d="M0" />, { namespaceURI: "http://www.w3.org/2000/svg" }));
  say(await stream(say, <div>{Array.from({ length: 30 }, (_, i) => <Suspense key={i} fallback={"f" + i}><p>{"content ".repeat(20) + i}</p></Suspense>)}</div>, { progressiveChunkSize: 200 }));
  say(await stream(say, <div><Suspense fallback="f"><p>{"big ".repeat(5000).length}</p><span>{"big ".repeat(5000)}</span></Suspense></div>).then(t => t.length + " characters"));
});

scenario("21 keys, fragments, deep and wide trees", async say => {
  const Deep = ({ n }: { n: number }): ReactNode => (n ? <div data-n={n}><Deep n={n - 1} /></div> : "bottom");
  say((await stream(say, <Deep n={300} />)).length + " characters");
  say((await stream(say, <ul>{Array.from({ length: 2000 }, (_, i) => <li key={i} className={i & 1 ? "odd" : undefined}>{i}</li>)}</ul>)).length + " characters");
  say(await stream(say, <>{[[<i key="a">a</i>], [[<i key="a">a again</i>]], <Fragment key="f"><b>b</b><b>c</b></Fragment>]}</>));
});

scenario("22 Activity, hidden and visible; a deferred value; a transition", async say => {
  const Effectful = ({ t }: { t: string }) => { useEffect(() => {}); return <i>{t}</i>; };
  say(await stream(say, <div><Activity mode="visible"><Effectful t="seen" /></Activity><Activity mode="hidden"><Effectful t="hidden" /></Activity><Activity><Effectful t="default" /></Activity></div>));
  const Slow = ({ p }: { p: Promise<string> }) => <b>{use(p)}</b>;
  const d = deferred<string>();
  say(await staged(say, <div><Activity mode="visible"><Suspense fallback="f"><Slow p={d.promise} /></Suspense></Activity><Activity mode="hidden"><Slow p={new Promise<string>(() => {})} /></Activity></div>, [() => d.resolve("in an activity")]));
});

scenario("23 the legacy entries beside it: renderToString, renderToStaticMarkup", say => {
  const Slow = () => <b>{use(new Promise<string>(() => {}))}</b>;
  say(renderToString(<div className="a">{"x"}{"y"}<Suspense fallback={<i>f</i>}><Slow /></Suspense></div>));
  say(renderToStaticMarkup(<div className="a">{"x"}{"y"}<input defaultValue="v" /></div>));
  say(renderToString(<i id={"x"}>{1}</i>, { identifierPrefix: "q" }));
  try { say(renderToString(<Slow />)); } catch (e) { say("threw " + told(e)); }
  say(typeof version);
});

scenario("24 many requests at once, each with its own contexts and ids", async say => {
  const C = createContext(-1);
  const Slow = ({ p }: { p: Promise<number> }) => { const id = useId(); return <b id={id}>{use(p)}:{useContext(C)}</b>; };
  const all = await Promise.all(Array.from({ length: 12 }, (_, i) => stream(say, <C value={i}><div><Suspense fallback={"f" + i}><Slow p={soon(i * 10)} /></Suspense><Suspense fallback="g"><C value={i + 100}><Slow p={i & 1 ? soon(i) : Promise.resolve(i)} /></C></Suspense></div></C>, {}, true)));
  for (const text of all) say(text);
});

scenario("25 refs, keys and children as props; what is passed through", async say => {
  const Show = (props: Record<string, unknown>) => <i>{Object.keys(props).sort().join(",")}:{typeof props.ref}:{typeof props.children}</i>;
  say(await stream(say, <div><Show a={1} key="k" ref={() => {}} /><Show {...{ children: "c" }} /><Show>{1}{2}</Show><div ref={{ current: null }} key="x" /></div>));
  const Spread = ({ k, ...rest }: { k: string; [name: string]: unknown }) => <b {...rest} key={k} />;
  say(await stream(say, <Spread k="kk" id="i" title="t" />));
});

// What `resume` is handed is GIVEN: a PostponedState that ANOTHER bundle made (react-dom/static: the node bundle, untyped) and that JSON may have carried: JSON drops the members that are undefined: its ResumableState has 14 of the 17 members the typed bundle's own births have. A VALUE THAT SATISFIES ITS TYPE IS NEVER REFUSED: so it is walked here, carried and as it is, by both entries.
scenario("26 a prerender postpones; the state is carried by JSON, or handed over as it is; the server resumes", async say => {
  if (legacy) { say("(no such entry there)"); return; }
  for (const way of ["carried by JSON", "as it is"]) for (const entry of ["resume", "resumeToPipeableStream"]) {
    const late = deferred<string>(), later = deferred<string>();
    const hints = () => { preload("a.png", { as: "image" }); preload("f.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" }); preinit("s.js", { as: "script" }); preinit("c.css", { as: "style", precedence: "p" }); preinitModule("m.js"); preloadModule("n.js"); preconnect("https://x.example"); prefetchDNS("https://y.example"); };
    const Late = ({ from, id }: { from: Promise<string>; id: string }) => { hints(); preload("late-" + id + ".png", { as: "image" }); return <i id={id}>{use(from)}:{useId()}<img src="a.png" /><script async src="s.js" /></i>; };
    const App = () => <html><head><title>t</title></head><body><main><h1>shell {(hints(), useId())}</h1><form action={async () => {}}><select defaultValue="b"><option value="a">a</option><option value="b">b</option></select></form><Suspense fallback={<b>wait 1</b>}><Late from={late.promise} id="one" /><link rel="stylesheet" href="late.css" precedence="p" /></Suspense><ul>{[1, 2].map(n => <li key={n}><Suspense fallback={<b>wait {n}</b>}><Late from={later.promise} id={"li" + n} /></Suspense></li>)}</ul></main></body></html>;
    const controller = new AbortController();
    const pending = prerender(<App />, { signal: controller.signal, identifierPrefix: "p", bootstrapScripts: ["boot.js"], bootstrapModules: [{ src: "boot.mjs", integrity: "sha" }], bootstrapScriptContent: "boot()", onError(e) { say("prerender onError " + told(e)); } });
    await quiet(); controller.abort(new Error("enough")); const { prelude, postponed } = await pending;
    say(way + ", " + entry + ": the prelude: " + await new Response(prelude).text());
    say("postponed: " + (postponed === null ? "null" : Object.keys(postponed).sort().join(",")));
    if (postponed === null) continue;
    const state = way === "as it is" ? postponed : JSON.parse(JSON.stringify(postponed)) as PostponedState;
    late.resolve("late"); later.resolve("later");
    if (entry === "resume") { const s = await resume(<App />, state, { onError(e) { say("resume onError " + told(e)); } }); await s.allReady; say("resumed: " + await new Response(s).text());
      // THE SAME STATE OBJECT ONCE MORE: React WRITES INTO WHAT IT IS HANDED (resumableState.instructions, the resource tables, nextFormID): a second resume sees those writes. A TYPED BUNDLE THAT COPIED THE GIVEN STATE INTO ITS LAYOUT WOULD WRITE INTO THE COPY: THE COPY WOULD BE SEEN HERE.
      say("the state afterwards: " + JSON.stringify((state as unknown as { resumableState: unknown }).resumableState));
      const again = await resume(<App />, state, { onError(e) { say("resume again onError " + told(e)); } }); await again.allReady; say("resumed again: " + await new Response(again).text()); }
    else say("resumed: " + await new Promise<string>(done => {
      const chunks: string[] = []; const sink = new Writable({ write(chunk, _encoding, next) { chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")); next(); }, final(next) { next(); done(chunks.join("")); } });
      const p = (resumeToPipeableStream as unknown as (children: ReactNode, state: PostponedState, options: { onError(e: unknown): void; onAllReady(): void }) => { pipe(to: Writable): void })(<App />, state, { onError(e) { say("resume onError " + told(e)); }, onAllReady() { p.pipe(sink); } });
    }));
  }
});

// an element that untyped react's createElement made WAS COPIED INTO THE LAYOUT at the elements' device, every node. Both makers side by side, held across renders, one element in two places, what a component sees.
scenario("27 elements of both makers: jsx() and createElement | cloneElement, held and rendered again", async say => {
  const Shown = ({ id, children }: { id: string; children?: ReactNode }) => <i id={id}>{Children.count(children)}{children}</i>;
  const byJsx = <Shown id="jsx"><b>a</b></Shown>, byCreate = createElement(Shown, { id: "create" }, createElement("b", null, "b")), byClone = cloneElement(byJsx, { id: "clone of jsx" }), byClone2 = cloneElement(byCreate, { id: "clone of create", key: "k" });
  const held = [byJsx, byCreate, byClone, byClone2];
  const Sees = ({ children, want }: { children: ReactNode; want: ReactNode }) => <u>{String(children === want)}:{String(isValidElement(children) && isValidElement(want) && children.props === want.props)}</u>;
  const page = () => <div>{byJsx}{byCreate}{byClone}{byClone2}<p>{byCreate}{byCreate}{byJsx}</p>{held.map((e, i) => <Sees key={i} want={e}>{e}</Sees>)}{createElement("ul", null, ...[0, 1, 2, 3].map(i => i & 1 ? createElement("li", { key: i }, i) : <li key={i}>{i}</li>))}{createElement(Fragment, null, "f", createElement("hr"))}{createElement(Suspense, { fallback: "w" }, createElement(memo(Shown), { id: "memo" }))}</div>;
  say(await stream(say, page())); say(await stream(say, page())); say(await pipe(say, page(), {}, "all"));
  say(held.map(e => [Object.keys(e).sort().join(), typeof e.type, String(e.key), Object.keys(e.props as object).sort().join()].join("|")).join(" ; "));
});

for (const [name, body] of scenarios) {
  if (only && !name.startsWith(only)) continue;
  console.log("== " + name + (legacy ? " [string]" : ""));
  try { await body(line => console.log("   " + line)); } catch (e) { console.log("   THREW " + told(e)); }
}
