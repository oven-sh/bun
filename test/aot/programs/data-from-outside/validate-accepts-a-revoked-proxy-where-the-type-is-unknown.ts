// validate<T>() doesn't look inside a value where T says unknown, any or object. A revoked Proxy there is accepted and returned as it is, however the object around it is read.
import { validate } from "bun:bundle";

function revokedProxy(target: object): object {
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  return proxy;
}

function show(name: string, proxy: object, validated: () => unknown): void {
  try {
    console.log(name + ": " + (validated() === proxy ? "the same proxy" : "another value"));
  } catch (error: any) {
    console.log(name + ": " + error.name);
  }
}

/** Plain data, as a parser makes it. */
function parsedWith(key: string, value: unknown): any {
  const holder = JSON.parse("{}");
  holder[key] = value;
  return holder;
}

/** An accessor beside the proxy, so that the holder is no plain data. */
function withAccessor(value: unknown): any {
  return {
    x: value,
    get y() {
      return 1;
    },
  };
}

const targets: [string, () => object][] = [
  ["an object", () => ({})],
  ["an array", () => []],
  ["a function", () => function () {}],
];

for (const [kind, target] of targets) {
  console.log("a revoked proxy of " + kind);
  const proxy = revokedProxy(target());

  show("unknown", proxy, () => validate<unknown>(proxy));
  show("any", proxy, () => validate<any>(proxy));
  show("object", proxy, () => validate<object>(proxy));

  show("{ x: unknown }, parsed", proxy, () => validate<{ x: unknown }>(parsedWith("x", proxy)).x);
  show("{ x: unknown }, a literal", proxy, () => validate<{ x: unknown }>({ x: proxy }).x);
  show("{ x: unknown }, beside an accessor", proxy, () => validate<{ x: unknown; y: number }>(withAccessor(proxy)).x);
  show("{ x: any }, parsed", proxy, () => validate<{ x: any }>(parsedWith("x", proxy)).x);
  show("{ x: any }, beside an accessor", proxy, () => validate<{ x: any; y: number }>(withAccessor(proxy)).x);
  show("{ x: object }, parsed", proxy, () => validate<{ x: object }>(parsedWith("x", proxy)).x);
  show("{ x: object }, beside an accessor", proxy, () => validate<{ x: object; y: number }>(withAccessor(proxy)).x);
  show("{ x?: unknown }, beside an accessor", proxy, () => validate<{ x?: unknown; y: number }>(withAccessor(proxy)).x);

  show("Record<string, unknown>, parsed", proxy, () => validate<Record<string, unknown>>(parsedWith("x", proxy)).x);
  show("Record<string, unknown>, beside an accessor", proxy, () => validate<Record<string, unknown>>(withAccessor(proxy)).x);
  show("a property that the type doesn't declare, parsed", proxy, () => (validate<{ y?: number }>(parsedWith("x", proxy)) as any).x);
  show("a property that the type doesn't declare, beside an accessor", proxy, () => (validate<{ y: number }>(withAccessor(proxy)) as any).x);

  show("unknown[]", proxy, () => validate<unknown[]>([proxy])[0]);
  show("unknown[], behind an accessor", proxy, () => validate<unknown[]>(Object.defineProperty([0, proxy], 0, { get: () => 1, enumerable: true }))[1]);
  show("[number, unknown]", proxy, () => validate<[number, unknown]>([1, proxy])[1]);

  // Where the type describes the value, it has to be read, and nothing of a revoked Proxy can be. It is never accepted.
  show("{ a: number }", proxy, () => validate<{ a: number }>(proxy));
  show("number[]", proxy, () => validate<number[]>(proxy));
  show("{ x: { a: number } }, parsed", proxy, () => validate<{ x: { a: number } }>(parsedWith("x", proxy)).x);
  show("{ x: { a: number } }, beside an accessor", proxy, () => validate<{ x: { a: number }; y: number }>(withAccessor(proxy)).x);
  show("{ x: number[] }, parsed", proxy, () => validate<{ x: number[] }>(parsedWith("x", proxy)).x);
  show("{ x: string }, parsed", proxy, () => validate<{ x: string }>(parsedWith("x", proxy)).x);
}
