// An object literal without a written type, with a spread of a source whose members are not all known behind its written members: the spread may bring a written member again, of another kind.
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = JSON.stringify(f()); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + r); };
const byObject = (more: object = {}) => ({ sound: 1, name: "shapes", ...more });
const byRecord = (more: Record<string, unknown> = {}) => ({ sound: 1, name: "shapes", ...more });
const byEmpty = (more: {} = {}) => ({ sound: 1, name: "shapes", ...more });
const byUnknown = (more: unknown = {}) => ({ sound: 1, name: "shapes", ...(more as object) });
const byAny = (more: any = {}) => ({ sound: 1, name: "shapes", ...more });
const spreadFirst = (more: object = {}) => ({ ...more, sound: 1, name: "shapes" });
const nested = (more: object = {}) => ({ install: { cache: "c", linker: "hoisted", ...more } });
for (const [name, f] of [["object", byObject], ["Record<string, unknown>", byRecord], ["{}", byEmpty], ["unknown as object", byUnknown], ["any", byAny], ["the spread first", spreadFirst], ["nested", nested]] as const) {
  row(name + ": nothing more", () => f());
  row(name + ": one member more", () => f({ extra: true }));
  row(name + ": a written member overridden by another kind", () => f({ sound: "loud" }));
  row(name + ": the result read", () => { const r = f({ extra: true }) as any; return [r.sound ?? r.install?.cache, r.extra ?? r.install?.extra, Object.keys(r)]; });
}
const port = (options: Record<string, unknown>) => { const made = { port: 80, host: "h", ...options }; return JSON.stringify(made); };
for (const given of ["81", undefined, null, 81]) row("into a variable, port " + String(given), () => port({ port: given }));
interface Written { port: number; host: string }
const written = (options: object): Written => ({ port: 80, host: "h", ...options });
row("under a written type: nothing more", () => written({}));
row("under a written type: one member more", () => written({ extra: true }));
function generic<T extends object>(more: T) { return { sound: 1, name: "shapes", ...more }; }
row("a type parameter", () => [generic({ extra: true }), generic({ sound: "loud" } as object)]);
interface Wide { model: string; max: number; judges?: boolean; a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: string[] }
const wide = (options: Wide) => [options.model, options.max, options.judges, options.h?.length];
for (const served of [true, false]) row("a conditional spread of a literal, then a written type, " + served, () => { const made = { model: "m", max: 1, ...(served && { judges: true }), h: ["h"] }; return [wide(made), Object.keys(made)]; });
row("one of two literals", () => { const made = { model: "m", ...(frames() ? { max: 1 } : { max: 2, a: 3 }) }; return [wide(made), Object.keys(made)]; });
function frames() { return Object.keys({}).length > 0; }
const twice = (a: object, b: object) => ({ first: 1, ...a, second: 2, ...b });
row("two spreads", () => [twice({}, {}), twice({ first: "f" }, { second: "s" }), twice({ second: "lost" }, { first: "last" })]);
