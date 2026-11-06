// A Worker is inside a native function for most of its time, some of which call compiled code back. It is terminated there.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

type Item = { key: number; name: string };
const items = (count: number): Item[] => Array.from({ length: count }, (_, i) => ({ key: (i * 7919) % count, name: "item" + i }));
const shared = new Int32Array(new SharedArrayBuffer(8));

const calls: Record<string, () => unknown> = {
  "Atomics.wait": () => Atomics.wait(shared, 0, 0),
  sort: () => {
    for (;;) items(50_000).sort((a, b) => a.key - b.key);
  },
  "JSON.parse": () => {
    const text = JSON.stringify(items(50_000));
    for (;;) JSON.parse(text, (key, value) => (typeof value === "number" ? value + 1 : value));
  },
  "JSON.stringify": () => {
    const list = items(50_000).map(item => ({ ...item, toJSON: () => item.name }));
    for (;;) JSON.stringify(list);
  },
  replace: () => {
    const text = "abc ".repeat(200_000);
    for (;;) text.replace(/[a-c]+/g, found => found.toUpperCase());
  },
  "a slow pattern": () => {
    for (;;) /^(a+)+$/.test("a".repeat(24) + "b");
  },
  structuredClone: () => {
    const list = items(50_000);
    for (;;) structuredClone(list);
  },
  pbkdf2Sync: () => {
    for (;;) pbkdf2Sync("secret", "salt", 200_000, 64, "sha512");
  },
  gzipSync: () => {
    const bytes = randomBytes(1 << 22);
    for (;;) gzipSync(bytes);
  },
  files: () => {
    for (;;) statSync(process.execPath), readdirSync(dirname(process.execPath));
  },
  "Array.from": () => {
    for (;;) Array.from({ length: 100_000 }, (_, i) => ({ i }));
  },
  "Map.forEach": () => {
    const map = new Map(items(50_000).map(item => [item.key, item]));
    let sum = 0;
    for (;;) map.forEach(item => (sum += item.key));
  },
  "a getter under Object.assign": () => {
    const source = {
      get slow() {
        let sum = 0;
        for (let i = 0; i !== -1; i = (i + 1) | 0) sum = (sum + i) | 0;
        return sum;
      },
    };
    return Object.assign({}, source);
  },
  "Reflect.apply": () => {
    function again(depth: number): number {
      return depth === 0 ? 0 : 1 + Reflect.apply(again, null, [depth - 1]);
    }
    for (;;) again(500);
  },
};

if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 1);
  for (const name of Object.keys(calls)) {
    if (process.env.ONLY && process.env.ONLY !== name) continue;
    const heard: string[] = [];
    for (let round = 0; round < rounds; round++) {
      const worker = new Worker(new URL(import.meta.url));
      const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
      await new Promise<void>(resolve => {
        worker.onmessage = event => (event.data === "enters" ? resolve() : heard.push(event.data));
        worker.postMessage(name);
      });
      await new Promise(resolve => setTimeout(resolve, 10 + round * 13));
      worker.terminate();
      await closed;
    }
    console.log(name, "closed", JSON.stringify(heard));
  }
} else {
  addEventListener("message", (event: MessageEvent<string>) => {
    postMessage("enters");
    try {
      calls[event.data]();
      postMessage("came back");
    } catch (error) {
      postMessage("caught " + error);
    } finally {
      postMessage("the finally ran");
    }
  });
}
