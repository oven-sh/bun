// The entry point starts a Worker on itself. Both threads evaluate the same class and make the same function, each over a heap of its own.
// What one posts arrives at the other as a copy that has the fields and is no instance of the class there, also where a Point is expected.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}

const double = (point: Point): number => point.x * 2;
const kept = { f: double };

function readX(point: Point): number {
  return point.x;
}

function isDouble(f: unknown): boolean {
  return f === double;
}

function describe(who: string, arrived: Point): string {
  const own = new Point(1, 2);
  const seen: unknown[] = [who];
  for (const point of [own, arrived, own, arrived])
    seen.push(point instanceof Point, readX(point), double(point), typeof point.sum);
  seen.push(own.sum(), isDouble(kept.f), isDouble(readX), Object.getPrototypeOf(arrived) === Object.prototype);
  return seen.join(" ");
}

if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const lines = await new Promise<string[]>(resolve => {
    const heard: string[] = [];
    worker.onmessage = event => {
      if (typeof event.data === "string") return resolve([...heard, event.data]);
      heard.push(describe("main", event.data));
      worker.postMessage(new Point(30, 40));
    };
  });
  worker.terminate();
  for (const line of lines) console.log(line);
} else {
  self.onmessage = event => postMessage(describe("worker", event.data));
  postMessage(new Point(10, 20));
}
