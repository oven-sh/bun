// The property that the program tests against its declared type is an accessor of an object from untyped code.
interface Meta { sign: string[] | true; secrets?: string }
const own: Meta = { sign: ["own"] };
const stored: unknown[] = [];
function normalize(app: any): string {
  const meta: Meta = app.cookie;
  if (typeof meta.sign === "string") meta.sign = [meta.sign];
  return JSON.stringify(meta) + " " + JSON.stringify(stored);
}
console.log(normalize({ cookie: own }));
console.log(normalize({ cookie: Object.defineProperty({}, "sign", { get() { return "one"; }, set(value) { stored.push(value); }, enumerable: true }) }));
