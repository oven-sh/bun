// What `as` does to a value that is not what the cast says: null or undefined and primitives.
function anyOf(x: unknown): any { return x }
const env: Record<string, string | undefined> = { SET: "yes" };
function show(label: string, v: unknown) { console.log(label, typeof v, String(v), v ? "truthy" : "falsy", v === undefined, v === null) }
show("env unset as string", env.UNSET as string);
show("env set as string", env.SET as string);
show("any undefined as string", anyOf(undefined) as string);
show("any null as string", anyOf(null) as string);
show("any undefined as number", anyOf(undefined) as number);
show("any null as number", anyOf(null) as number);
show("any undefined as boolean", anyOf(undefined) as boolean);
show("any 5 as string", anyOf(5) as string);
show("any '5' as number", anyOf("5") as number);
show("any 'x' as number", anyOf("x") as number);
show("any 0 as boolean", anyOf(0) as boolean);
show("any '' as boolean", anyOf("") as boolean);
show("any true as string", anyOf(true) as string);
interface Options { flag?: boolean; name?: string; size?: number }
function read(o: Options) { const flag = o.flag as boolean, name = o.name as string, size = o.size as number; return [flag === undefined ? "default" : flag, name === undefined ? "default" : name, size === undefined ? "default" : size].join() }
console.log(read({}), read({ flag: false, name: "", size: 0 }));
const token = env.TOKEN as string; console.log(token ? "has a token: " + token : "no token");
// The TypeScript compiler's scanner.ts:4036. Unlike plain JavaScript: null or undefined that a cast has let through is converted where it enters a DECLARED raw place: plain: undefined; ours: NaN.
function codePointAt(s: string, i: number): number { return s.codePointAt(i) as number }
show("declared result, out of bounds", codePointAt("a", 5));
show("declared result, in bounds", codePointAt("a", 0));
