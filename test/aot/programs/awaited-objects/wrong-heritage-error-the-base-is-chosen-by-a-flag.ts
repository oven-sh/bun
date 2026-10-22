// Heavy extends Body or Error, by a flag that is read at run time.
import { inspect, types } from "node:util";

class Body {
  mass = 1;
  constructor(...ignored: unknown[]) {}
  weight(): number {
    return this.mass * 2;
  }
}

const flag = JSON.parse("0");

class Heavy extends ((flag ? Body : Error) as typeof Body) {
  extra = 5;
  constructor(...list: unknown[]) {
    super(...list);
  }
  weight(): number {
    return (this.extra === undefined ? 7 : this.extra * 3) + (this.mass === undefined ? 100 : this.mass);
  }
}

class Light extends Body {
  lift = 1;
  weight(): number {
    return this.mass - this.lift;
  }
}

function measure(bodies: Body[]): string {
  let total = 0;
  try {
    for (let round = 0; round < 200; round++) {
      for (const body of bodies) total += (typeof body.weight === "function" ? body.weight() : -1) + (body.mass === undefined ? 1000 : body.mass);
    }
  } catch (error) {
    return (error as Error).name;
  }
  return String(total);
}

function attempt(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return (error as Error).name;
  }
}

async function probe(x: any): Promise<string> {
  const lengthOfTypedArray = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length")!.get!;
  const resolved = Promise.resolve(x);
  resolved.catch(() => {});
  return [
    typeof x,
    Array.isArray(x),
    attempt(() => JSON.stringify(x)),
    attempt(() => [0].concat(x).length),
    attempt(() => Array.from(x).length),
    attempt(() => Object.prototype.toString.call(structuredClone(x))),
    Object.prototype.toString.call(x),
    [types.isPromise(x), types.isMap(x), types.isSet(x), types.isRegExp(x), types.isDate(x), types.isNativeError(x), types.isUint8Array(x)].map(Number).join(""),
    resolved === x,
    await (async () => (await x) === x)().catch(error => (error as Error).name),
    x instanceof Error,
    x instanceof Heavy,
    attempt(() => Promise.prototype.then.call(x, () => 0) instanceof Promise),
    attempt(() => Map.prototype.get.call(x, 1)),
    attempt(() => Set.prototype.has.call(x, 1)),
    attempt(() => RegExp.prototype.exec.call(x, "caab")?.[0]),
    attempt(() => Date.prototype.getTime.call(x)),
    attempt(() => lengthOfTypedArray.call(x)),
    typeof x.stack,
    attempt(() => inspect(x).split("\n")[0]),
    types.isNativeError(x) ? "error" : Bun.inspect(x).split("\n")[0],
    Object.keys(x).join("+"),
    [attempt(() => x.length), attempt(() => x.size), attempt(() => x.source), attempt(() => x.message), attempt(() => x.byteLength), x[0], 0 in x].join("/"),
    [typeof x.then, typeof x.getTime, typeof x.has, typeof x.push, typeof x.exec, typeof x.fill].map(kind => kind.length).join(""),
    attempt(() => {
      let steps = 0;
      for (const one of x) steps += one === undefined ? 1 : 2;
      return steps;
    }),
    attempt(() => [...x].length),
    attempt(() => ((x[5] = 300), x[5] + "/" + x.length)),
    attempt(() => ((x.length = 1), Object.keys(x).length)),
    attempt(() => (Error.captureStackTrace(x), typeof x.stack)),
  ].join();
}

const strange: any = new Heavy("message");
const world: Body[] = [new Light(), new Light(), new Body(), strange];
const seen: unknown[] = [measure(world)];
seen.push(await probe(world[0]), await probe(strange), measure(world));
console.log(seen.join(" "));
