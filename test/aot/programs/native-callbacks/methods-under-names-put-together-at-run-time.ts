// Methods found through instances: each function here is stored under a name or a symbol that is put together at run time, so nothing in the text says that it is the toJSON, the then or the custom inspect method which one native caller looks for. A bit is set for each function that got no number.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}
const glue = (...parts: string[]): string => parts.join("");
const holding = (key: string | symbol, value: unknown): any => {
  const holder: any = {};
  holder[key] = value;
  return holder;
};

function asToJSON(value: number): any { if (typeof value !== "number") bits |= 1; return "."; }
function asToString(value: number): any { if (typeof value !== "number") bits |= 2; return "."; }
function asValueOf(value: number): any { if (typeof value !== "number") bits |= 4; return "."; }
function asThen(value: number): any { if (typeof value !== "number") bits |= 8; return "."; }
function asInspect(value: number): any { if (typeof value !== "number") bits |= 16; return "."; }
function asBunInspect(value: number): any { if (typeof value !== "number") bits |= 32; return "."; }
function asHandleEvent(value: number): any { if (typeof value !== "number") bits |= 64; return "."; }
function asNext(value: number): any { if (typeof value !== "number") bits |= 128; return "."; }
function asGetTrap(value: number): any { if (typeof value !== "number") bits |= 256; return "."; }
function asStart(value: number): any { if (typeof value !== "number") bits |= 512; return "."; }
function asGetter(value: number): any { if (typeof value !== "number") bits |= 1024; return "."; }
function asIterator(value: number): any { if (typeof value !== "number") bits |= 2048; return "."; }
function asToPrimitive(value: number): any { if (typeof value !== "number") bits |= 4096; return "."; }
function asExec(value: number): any { if (typeof value !== "number") bits |= 8192; return "."; }
function asToISOString(value: number): any { if (typeof value !== "number") bits |= 16384; return "."; }
function asWrite(value: number): any { if (typeof value !== "number") bits |= 32768; return "."; }
function asJoin(value: number): any { if (typeof value !== "number") bits |= 65536; return "."; }
function asResolve(value: number): any { if (typeof value !== "number") bits |= 131072; return "."; }

asToJSON(1);
attempt(() => JSON.stringify(holding(glue("to", "JSON"), asToJSON)));
asToString(1);
attempt(() => String(holding(glue("to", "String"), asToString)));
asValueOf(1);
attempt(() => Number(holding(glue("value", "Of"), asValueOf)));
asThen(1);
attempt(() => Promise.resolve(holding(glue("th", "en"), asThen)));
asInspect(1);
attempt(() => console.log(holding(Symbol.for(glue("nodejs.util.", "inspect.custom")), asInspect)));
asBunInspect(1);
attempt(() => Bun.inspect(holding(Symbol.for(glue("nodejs.util.", "inspect.custom")), asBunInspect)));
asHandleEvent(1);
attempt(() => { const target = new EventTarget(); target.addEventListener("e", holding(glue("handle", "Event"), asHandleEvent)); target.dispatchEvent(new Event("e")); });
asNext(1);
attempt(() => Array.from({ [Symbol.iterator]: () => holding(glue("ne", "xt"), asNext) } as any));
asGetTrap(1);
attempt(() => (new Proxy({}, holding(glue("g", "et"), asGetTrap)) as any).x);
asStart(1);
attempt(() => new ReadableStream(holding(glue("st", "art"), asStart)));
asGetter(1);
attempt(() => (Object.defineProperty({}, "k", holding(glue("g", "et"), asGetter)) as any).k);
asIterator(1);
attempt(() => [...holding((Symbol as any)[glue("iter", "ator")], asIterator)]);
asToPrimitive(1);
attempt(() => `(new asToPrimitive() as any){holding((Symbol as any)[glue("to", "Primitive")], asToPrimitive)}`);
asExec(1);
attempt(() => RegExp.prototype.test.call(holding(glue("ex", "ec"), asExec), "a"));
asToISOString(1);
attempt(() => Date.prototype.toJSON.call(holding(glue("toISO", "String"), asToISOString)));
asWrite(1);
attempt(() => new WritableStream(holding(glue("wri", "te"), asWrite)).getWriter().write("c"));
asJoin(1);
attempt(() => Array.prototype.toString.call(holding(glue("jo", "in"), asJoin)));
asResolve(1);
attempt(() => (Promise.all as any).call(Object.assign(function (this: any, executor: any) { executor(() => 0, () => 0); }, holding(glue("res", "olve"), asResolve)), ["s"]));
setTimeout(() => console.log(bits.toString(2)), 5);
