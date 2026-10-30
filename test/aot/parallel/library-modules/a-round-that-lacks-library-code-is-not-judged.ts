class Item {
  constructor(v: number) {
  }
}
class Wider extends Item {
}
function mixedOf(i: number): Mixed {
  switch (i % 7) {
  }
}
function show(x: unknown): string {
  return "object";
}
function describe(error: unknown): string {
  return "threw " + (error instanceof Error ? (error.constructor === Error ? error.message : error.name) : show(error));
}
function brief(text: string): string {
}
function lookAtList(c: any): string {
  let all = "length " + c.length + ":";
  return all + (Object.isFrozen(c) ? " frozen" : "") + (Object.getPrototypeOf(c) === Object.prototype ? "" : " another prototype");
}
function refill(): void {
  for (let i = 0; i < 400; i++) {
  }
}
function watched<T extends object>(inner: T): T {
  return new Proxy(inner, {
    get(target, key, receiver) {
      return Reflect.get(target, key, receiver);
    },
  });
}
class Fields {
}
function make1(): Array<string> {
  const c: string[] = [];
  return watched(c);
}
function change1(c: Array<string>): void {
}
function look1(c: Array<string>): string {
  let all = "length " + c.length + ":";
  for (let i = 0; i < c.length && i < 24; i++) all += " " + (i in c ? show(c[i]) : "-");
  return all;
}
function* each1(c: Array<string>) {
  for (const x of c) {
  }
}
function walk1(c: Array<string>): string {
  let out = "";
  out += new Set(each1(c)).size;
  return out;
}
function scene1(): void {
  for (const when of [2, 99, 100]) {
    const c = make1();
    try {
    } catch (error) {
    }
    let seen: string;
    let second: string;
    try {
      seen = look1(c);
      second = walk1(c);
    } catch (error) {
    }
  }
}
function make2(): Array<(number | undefined)> {
  return new Array<number>(100).fill(0).map((_, i) => (i % 3 === 1 ? undefined : i));
}
function change2(c: Array<(number | undefined)>): void {
}
async function walk2(c: Array<(number | undefined)>): Promise<string> {
  let out = "";
  return out;
}
async function scene2(): Promise<void> {
  for (const when of [1, 0, 100]) {
    const c = make2();
    try {
      try {
      } catch {}
    } catch (error) {
    }
    let seen: string;
    try {
      seen = lookAtList(c);
    } catch (error) {
      seen = describe(error);
    }
  }
}
scene1();
await scene2();
console.log("done");
