// A Worker sits in one counted loop: it rises, falls, takes strides, stands inside another loop, is tested at its bottom, or has two counters that meet. What ends the loop is a number, the
// length of a view of 256 MB that is only read, or the length of a list that was set to billions by hand. A turn reads the view, reads the list, or touches nothing. No loop calls anything
// or allocates, and each would go on for seconds: every one of them has to look up often enough for the Worker to be terminated soon.
let kept = 0;

type Walk = (view: Uint8Array, list: number[], limit: number) => void;

const mixed = (h: number, i: number, value: number): number => ((((((h + i) | 0) % (value + 7)) + i) | 0) % (value + 11)) | 0;
const at = (list: number[], i: number): number => (list[i] === undefined ? 1 : 2);

const walks: Record<string, Walk> = {
  "rises below a number over a view"(view, list, limit) { let h = 1; for (let i = 0; i < limit; i++) h = mixed(h, i, view[i]!); kept = h; },
  "rises below a length over a view"(view) { let h = 1; for (let i = 0; i < view.length; i++) h = mixed(h, i, view[i]!); kept = h; },
  "falls from a number over a view"(view, list, limit) { let h = 1; for (let i = limit - 1; i >= 0; i--) h = mixed(h, i, view[i]!); kept = h; },
  "falls from a length over a view"(view) { let h = 1; for (let i = view.length - 1; i >= 0; i--) h = mixed(h, i, view[i]!); kept = h; },
  "takes strides below a number over a view"(view, list, limit) { let h = 1; const half = limit >> 1; for (let i = 0; i < half; i++) h = mixed(mixed(h, i, view[2 * i + 1]!), i, 3); kept = h; },
  "takes strides below a length over a view"(view) { let h = 1; for (let i = 0; i < view.length; i += 2) h = mixed(mixed(h, i, view[i]!), i, 3); kept = h; },
  "stands inside a loop below a number over a view"(view, list, limit) { let h = 1; const width = limit >> 1; for (let r = 0; r < 2; r++) for (let c = 0; c < width; c++) h = mixed(mixed(h, c, view[r * width + c]!), c, 3); kept = h; },
  "stands inside a loop below a length over a view"(view) { let h = 1; const width = view.length >> 1; for (let r = 0; r < 2; r++) for (let c = 0; c < width; c++) h = mixed(mixed(h, c, view[r * width + c]!), c, 3); kept = h; },
  "stands around a loop of four turns below a number over a view"(view, list, limit) { let h = 1; const rows = limit >> 2; for (let r = 0; r < rows; r++) for (let c = 0; c < 4; c++) h = mixed(h, c, view[r * 4 + c]!); kept = h; },
  "is tested at the bottom below a number over a view"(view, list, limit) { let h = 1; let i = 0; do h = mixed(h, i, view[i]!); while (++i < limit); kept = h; },
  "is tested at the bottom below a length over a view"(view) { let h = 1; let i = 0; do h = mixed(h, i, view[i]!); while (++i < view.length); kept = h; },
  "has counters that meet from a number over a view"(view, list, limit) { let h = 1; let low = 0; let high = limit - 1; while (low < high) { h = mixed(mixed(h, low, view[low]! + view[high]!), low, 3); low++; high--; } kept = h; },
  "has counters that meet from a length over a view"(view) { let h = 1; let low = 0; let high = view.length - 1; while (low < high) { h = mixed(mixed(h, low, view[low]! + view[high]!), low, 3); low++; high--; } kept = h; },
  "takes the elements of a view"(view) { let h = 1; for (const value of view) h = mixed(h, 3, value); kept = h; },

  "rises below a number over a list"(view, list, limit) { let h = 1; for (let i = 0; i < limit * 8; i++) h = mixed(h, i, at(list, i)); kept = h; },
  "rises below a length set by hand over a list"(view, list) { let h = 1; for (let i = 0; i < list.length; i++) h = mixed(h, i, at(list, i)); kept = h; },
  "falls from a length set by hand over a list"(view, list) { let h = 1; for (let i = list.length - 1; i >= 0; i--) h = mixed(h, i, at(list, i)); kept = h; },
  "takes strides below a length set by hand over a list"(view, list) { let h = 1; for (let i = 0; i < list.length; i += 2) h = mixed(h, i, at(list, i)); kept = h; },
  "stands inside a loop below a length set by hand over a list"(view, list) { let h = 1; const width = list.length >> 1; for (let r = 0; r < 2; r++) for (let c = 0; c < width; c++) h = mixed(h, c, at(list, r * width + c)); kept = h; },
  "is tested at the bottom below a length set by hand over a list"(view, list) { let h = 1; let i = 0; do h = mixed(h, i, at(list, i)); while (++i < list.length); kept = h; },
  "has counters that meet from a length set by hand over a list"(view, list) { let h = 1; let low = 0; let high = list.length - 1; while (low < high) { h = mixed(h, low, at(list, low) + at(list, high)); low++; high--; } kept = h; },
  "takes the elements of a list whose length was set by hand"(view, list) { let h = 1; for (const value of list) h = mixed(h, 3, value === undefined ? 1 : 2); kept = h; },

  "rises below a number"(view, list, limit) { let h = 1; for (let i = 0; i < limit * 8; i++) h = mixed(h, i, 3); kept = h; },
  "rises below the length of a view"(view) { let h = 1; for (let i = 0; i < view.length; i++) h = mixed(h, i, 3); kept = h; },
  "rises below a length set by hand"(view, list) { let h = 1; for (let i = 0; i < list.length; i++) h = mixed(h, i, 3); kept = h; },
  "falls from a number"(view, list, limit) { let h = 1; for (let i = limit * 8 - 1; i >= 0; i--) h = mixed(h, i, 3); kept = h; },
  "falls from the length of a view"(view) { let h = 1; for (let i = view.length - 1; i >= 0; i--) h = mixed(h, i, 3); kept = h; },
  "takes strides below a number"(view, list, limit) { let h = 1; for (let i = 0; i < limit * 8; i += 3) h = mixed(h, i, 3); kept = h; },
  "stands inside a loop below a number"(view, list, limit) { let h = 1; for (let r = 0; r < 2; r++) for (let c = 0; c < limit * 4; c++) h = mixed(h, c, r + 3); kept = h; },
  "is tested at the bottom below a number"(view, list, limit) { let h = 1; let i = 0; do h = mixed(h, i, 3); while (++i < limit * 8); kept = h; },
  "has counters that meet from a number"(view, list, limit) { let h = 1; let low = 0; let high = limit * 8 - 1; while (low < high) { h = mixed(h, low, 3); low++; high--; } kept = h; },
};

type Order = { way: string; count: number };

if (Bun.isMainThread) {
  for (const way of Object.keys(walks)) {
    const worker = new Worker(new URL(import.meta.url));
    const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    worker.postMessage({ way, count: 0x10000000 } satisfies Order);
    await started;
    await new Promise(resolve => setTimeout(resolve, 30));
    const asked = performance.now();
    worker.terminate();
    await closed;
    console.log("a loop that", way + ":", "the Worker is closed, soon:", performance.now() - asked < 1000);
  }
} else {
  addEventListener("message", (event: MessageEvent<Order>) => {
    const { way, count } = event.data;
    const view = new Uint8Array(way.includes("view") ? count : 8);
    const list: number[] = [count, count + 1, count + 2.5];
    if (way.includes("by hand")) list.length = count * 7;
    const walk = walks[way]!;
    postMessage("walks");
    for (let round = 0; round < count; round++) walk(view, list, count);
    postMessage("kept " + kept);
  });
}
