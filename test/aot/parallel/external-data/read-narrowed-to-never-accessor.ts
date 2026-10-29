// The property that the program tests against its declared type is an accessor of an object from untyped code. What the getter returns is tested like the value of a field: a string where `string[] | true` is written throws a TypeError at the read, also under `typeof`.
interface Meta { sign: string[] | true; secrets?: string }
const own: Meta = { sign: ["own"] };
const stored: unknown[] = [];
function normalize(app: any): string {
  const meta: Meta = app.cookie;
  if (typeof meta.sign === "string") meta.sign = [meta.sign];
  return JSON.stringify(meta) + " " + JSON.stringify(stored);
}
console.log(normalize({ cookie: own }));
try { console.log(normalize({ cookie: Object.defineProperty({}, "sign", { get() { return "one"; }, set(value) { stored.push(value); }, enumerable: true }) })); } catch (e) { console.log("a getter that returns a string:", (e as Error).constructor.name); }
