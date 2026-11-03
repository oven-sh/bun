// A Worker fills Maps and Sets in counted loops, from lists and from other collections, and then walks over them for ever. It is terminated at once behind its first word, while it fills: the request must not get lost in the growing of a table. COUNT says how often each.
type Item = { key: number; name: string };
const fills: Record<string, () => unknown> = {
  "a Map in a counted loop": () => {
    const map = new Map<number, Item>();
    for (let i = 0; i < 50_000; i++) map.set(i, { key: i, name: "item" + i });
    let sum = 0;
    for (;;) map.forEach(item => (sum += item.key));
  },
  "a Set in a counted loop": () => {
    const set = new Set<string>();
    for (let i = 0; i < 50_000; i++) set.add("item" + i);
    let sum = 0;
    for (;;) for (const text of set) sum += text.length;
  },
  "a Map from a list of pairs": () => {
    const pairs = Array.from({ length: 50_000 }, (_, i): [number, Item] => [i, { key: i, name: "item" + i }]);
    const map = new Map(pairs);
    let sum = 0;
    for (;;) for (const [key, item] of map) sum += key + item.key;
  },
  "a Set from a list": () => {
    const set = new Set(Array.from({ length: 50_000 }, (_, i) => i * 3));
    let sum = 0;
    for (;;) set.forEach(value => (sum += value));
  },
  "a Map from a Map": () => {
    const first = new Map<string, number>();
    for (let i = 0; i < 30_000; i++) first.set("k" + i, i);
    const second = new Map(first);
    let sum = 0;
    for (;;) for (const value of second.values()) sum += value;
  },
  "a Map over the length of a list": () => {
    const list = Array.from({ length: 50_000 }, (_, i) => "n" + i);
    const map = new Map<string, number>();
    for (let i = 0; i < list.length; i++) map.set(list[i], i);
    let sum = 0;
    for (;;) for (const key of map.keys()) sum += key.length;
  },
};

if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 8);
  for (const name of Object.keys(fills)) {
    for (let round = 0; round < rounds; round++) {
      const worker = new Worker(new URL(import.meta.url));
      const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
      await new Promise<void>(resolve => {
        worker.onmessage = () => resolve();
        worker.postMessage(name);
      });
      if (round % 4) await new Promise(resolve => setTimeout(resolve, round % 4));
      worker.terminate();
      await closed;
    }
    console.log(name, "closed");
  }
} else {
  addEventListener("message", (event: MessageEvent<string>) => {
    postMessage("fills");
    fills[event.data]();
  });
}
