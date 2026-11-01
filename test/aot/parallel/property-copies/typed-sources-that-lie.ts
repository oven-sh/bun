export {};
// Declared types promise a shape; the values come through `any` and do not keep the promise.
interface Options { host: string; port: number; secure?: boolean; tags?: string[] }
interface Full extends Options { id: number }
const marker = Symbol("marker");
function describe(value: object): string {
  return Reflect.ownKeys(value).map(key => {
    const d = Reflect.getOwnPropertyDescriptor(value, key)!;
    return String(key) + ":" + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + ":" + ("value" in d ? JSON.stringify(d.value) ?? String(d.value) : "accessor");
  }).join(" ");
}
const withId = (o: Options, id: number): Full => ({ ...o, id });
const idFirst = (o: Options, id: number): Full => ({ id, ...o });
const defaults = (o: Partial<Options>): Options => ({ host: "localhost", port: 80, ...o });
const withoutPort = (o: Options) => { const { port, ...rest } = o; return rest; };
const merged = (a: Options, b: Partial<Options>): Options => Object.assign({}, a, b);
const clone = (o: Options): Options => ({ ...o });
const forms: Record<string, (o: any, i: number) => object> = { withId, idFirst, defaults, withoutPort, merged: (o, i) => merged({ host: "m", port: i }, o), clone };

const honest = (i: number): Options => i % 3 ? { host: "h" + i, port: i } : { host: "h" + i, port: i, secure: true };
const liars: Record<string, any> = {
  "port is a string": { host: "h", port: "eighty" },
  "port is a fraction": { host: "h", port: 80.5 },
  "port is huge": { host: "h", port: 2 ** 40 },
  "port is minus zero": { host: "h", port: -0 },
  "host is missing": { port: 1 },
  "host is undefined": { host: undefined, port: 1 },
  "host is null": { host: null, port: 1 },
  "other order": { port: 1, host: "h" },
  "extra names": { host: "h", extra: 1, port: 2, more: [1] },
  "a getter": { host: "h", get port() { return 8080; } },
  "a symbol": { host: "h", [marker]: 1, port: 2 },
  "an index": { host: "h", 0: "zero", port: 2 },
  "id already": { id: "mine", host: "h", port: 2 },
  "parsed": JSON.parse('{"host":"p","port":3,"secure":false,"tags":["a"]}'),
  "parsed with __proto__": JSON.parse('{"host":"p","__proto__":{"x":1},"port":3}'),
  "a class instance": new (class { host = "c"; port = 4; #p = 1; method() {} })(),
  "frozen": Object.freeze({ host: "f", port: 5 }),
  "non-enumerable port": Object.defineProperty({ host: "h" }, "port", { value: 6, enumerable: false }),
  "a list": ["x", "y"],
  "a string": "ab",
  "null": null,
  "undefined": undefined,
  "a number": 3,
};
for (const name in forms) {
  const form = forms[name];
  let count = 0;
  for (let i = 0; i < 50; i++) count += Object.keys(form(honest(i), i)).length;
  console.log(name, count);
  for (const liar in liars) {
    let shown: string;
    try { shown = describe(form(liars[liar], 7)); } catch (e: any) { shown = "threw " + e.constructor.name; }
    console.log(name, "|", liar, "|", shown);
  }
  console.log(name, "| honest again |", describe(form(honest(4), 9)));
}
