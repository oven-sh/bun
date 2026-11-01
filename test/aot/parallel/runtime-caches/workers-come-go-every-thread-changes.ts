// Every thread runs the same work on its own objects and prototypes: shapes are made and dropped, members of prototypes come and go, collections run. Workers end while others go on. Each answer is held to the main thread's.
declare var self: Worker;
class Animal { name: string; legs: number; constructor(n: string, l: number) { this.name = n; this.legs = l; } speak(): string { return this.name + this.legs; } get twice(): number { return this.legs * 2; } }
class Dog extends Animal { tail = true; speak(): string { return "dog " + super.speak(); } }
function readAll(o: any): string { return [o.name, o.legs, o.tail, o.twice, o.size, o.missing, o.extra, o.length, typeof o.speak, typeof o.get, typeof o.trim, typeof o.getOrInsert, o.message].join(); }
function work(seed: number): string {
    let state = seed * 2654435761 >>> 0;
    const next = (n: number) => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return (state >>> 8) % n; };
    let sum = 0;
    const add = (t: string) => { for (let i = 0; i < t.length; i++) sum = (Math.imul(sum, 31) + t.charCodeAt(i)) | 0; };
    const pool: any[] = [new Animal("a", 4), new Dog("d", 4), new Map([[1, 2]]), new Set([1]), [1, 2, 3], "text", new Error("e"), { name: "lit", legs: 2 }, new Date(0), Object.create({ extra: 1 }), new Uint8Array(3), () => 1];
    const protos: any[] = [Animal.prototype, Dog.prototype, Map.prototype, Set.prototype, Error.prototype, String.prototype, Date.prototype, Object.getPrototypeOf(pool[9])];
    const open: [any, string][] = [[Map.prototype, "getOrInsert"], [Set.prototype, "union"], [String.prototype, "trim"], [Error.prototype, "message"], [Animal.prototype, "speak"], [Dog.prototype, "speak"], [Date.prototype, "toString"]];
    const kept = open.map(([o, k]) => Object.getOwnPropertyDescriptor(o, k)!);
    for (let step = 0; step < 400; step++) {
        switch (next(10)) {
        case 0: { const p = protos[next(protos.length)]; const n = 20 + next(90); for (let i = 0; i < n; i++) p["t" + i] = i; for (let i = 0; i < n; i++) delete p["t" + i]; break; }
        case 1: { const i = next(open.length); delete open[i][0][open[i][1]]; break; }
        case 2: { const i = next(open.length); Object.defineProperty(open[i][0], open[i][1], kept[i]); break; }
        case 3: { const i = next(open.length); Object.defineProperty(open[i][0], open[i][1], { get() { return () => "g" + i; }, configurable: true }); break; }
        case 4: { const o: any = {}; const n = next(40); for (let i = 0; i < n; i++) o["k" + next(50)] = i; add(Object.keys(o).join()); pool[7] = next(2) ? o : { name: "lit", legs: step }; break; }
        case 5: { protos[next(protos.length)].extra = step; break; }
        case 6: { for (const p of protos) delete p.extra; break; }
        case 7: { if (next(8) === 0) Bun.gc(true); break; }
        case 8: { const o = pool[next(2)]; o["own" + next(5)] = step; if (next(3) === 0) delete o["own" + next(5)]; break; }
        default: break;
        }
        for (const o of pool) add(readAll(o));
        try { add(pool[1].speak() + pool[0].speak() + "  x ".trim() + String(pool[6]) + pool[2].getOrInsert(3, 4)); } catch (e: any) { add(e.constructor.name); }
    }
    open.forEach(([o, k], i) => Object.defineProperty(o, k, kept[i]));
    for (const p of protos) delete p.extra;
    return String(sum);
}
if (Bun.isMainThread) {
    const seeds = 6;
    const expected: string[] = []; for (let s = 0; s < seeds; s++) expected.push(work(s));
    let right = 0, wrong = 0, ended = 0;
    for (let round = 0; round < 6; round++) {
        const workers: Worker[] = []; const waits: Promise<void>[] = [];
        for (let i = 0; i < 12; i++) {
            const worker = new Worker(import.meta.url); workers.push(worker);
            waits.push(new Promise<void>(resolve => {
                let answers = 0;
                worker.onmessage = (event: MessageEvent) => { const [seed, answer] = event.data; if (answer === expected[seed]) right++; else wrong++; if (++answers === seeds) resolve(); };
                if (i % 3 === 2) setTimeout(() => { worker.terminate(); ended++; resolve(); }, 5 + i * 7);
            }));
            worker.postMessage(seeds);
        }
        for (let s = 0; s < seeds; s++) if (work(s) !== expected[s]) wrong++;
        await Promise.all(waits);
        for (const worker of workers) await worker.terminate();
    }
    console.log("wrong", wrong, right > 100);
} else {
    self.onmessage = (event: MessageEvent) => { for (let s = 0; s < event.data; s++) self.postMessage([s, work(s)]); };
}
