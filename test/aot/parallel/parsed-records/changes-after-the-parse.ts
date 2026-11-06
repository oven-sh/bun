const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface Config { host: string; port: number; secure?: boolean }
function url(config: Config): string {
  return `${config.secure ? "https" : "http"}://${config.host}:${config.port}`;
}
leak({ host: "", port: 0, secure: false } satisfies Config);
console.log(url({ host: "h", port: 1 }));
const text = '{"host":"example.com","port":8080,"secure":true}';
function parseText(): any {
  return parse(text);
}
function report(label: string, value: any) {
  let shown: string;
  try {
    shown = url(value);
  } catch (error) {
    shown = String(error);
  }
  console.log(label, shown, Object.keys(value).join(), JSON.stringify(value), JSON.stringify(Object.getOwnPropertyDescriptors(value)));
}
for (let round = 0; round < 3; round++) {
  let value = parseText();
  delete value.port;
  report("delete", value);
  value.port = 1;
  report("add again", value);
  value = parseText();
  value.extra = [1];
  value[5] = "five";
  value[Symbol.for("s")] = 1;
  report("add", value);
  console.log(Object.getOwnPropertySymbols(value).length, Reflect.ownKeys(value).length);
  value = parseText();
  value.port = "eighty";
  value.host = 5;
  value.secure = null;
  report("other types", value);
  value = parseText();
  Object.defineProperty(value, "port", { get: () => 99, enumerable: false, configurable: true });
  report("getter", value);
  value = parseText();
  Object.defineProperty(value, "host", { value: "fixed", writable: false });
  try {
    "use strict";
    value.host = "changed";
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
  report("read-only", value);
  value = parseText();
  Object.freeze(value);
  console.log(Object.isFrozen(value), Object.isSealed(value), Object.isExtensible(value));
  try {
    value.port = 2;
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
  report("frozen", value);
  value = parseText();
  Object.setPrototypeOf(value, { inherited: 1, get port2() { return (this as any).port + 1; } });
  console.log(value.inherited, value.port2, value instanceof Object);
  report("prototype", value);
  value = parseText();
  Object.setPrototypeOf(value, null);
  report("no prototype", value);
  value = parseText();
  const proxy = new Proxy(value, {});
  report("proxy", proxy);
  console.log(structuredClone(parseText()), Bun.deepEquals(parseText(), parseText()), Bun.inspect(parseText()));
  const map = new Map([[parseText(), 1]]);
  const weak = new WeakMap([[value, 2]]);
  console.log(map.size, weak.get(value));
}
export {};
