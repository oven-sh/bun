// Views of which the compiler knows nothing are iterated: by for-of, by their three iterators, by a spread, a pattern, Array.from. At every step the iterator asks the view how long it is NOW, and throws where its memory
// has gone or no longer reaches it: memory handed on in the middle of a loop, a buffer that shrinks below a view of a fixed length, a view that follows its buffer while that grows and shrinks.
(globalThis as any).shelfOfTheViews = {};
const shelf: any = (globalThis as any).shelfOfTheViews;
const lines: string[] = [];
function attempt(what: string, run: () => unknown) { try { lines.push(what + ": " + String(run())); } catch (error) { lines.push(what + ": " + (error as Error).constructor.name + ": " + (error as Error).message); } }
function walk(values: any, atStep?: (step: number) => void): string { let seen = "", step = 0; for (const value of values) { seen += value + " "; atStep?.(step++); if (step > 40) break; } return "[" + seen.trim() + "]"; }

const kinds: [string, (n: number) => any][] = [
    ["Int8Array", n => new Int8Array(n)], ["Uint8Array", n => new Uint8Array(n)], ["Uint8ClampedArray", n => new Uint8ClampedArray(n)], ["Int16Array", n => new Int16Array(n)], ["Uint16Array", n => new Uint16Array(n)],
    ["Int32Array", n => new Int32Array(n)], ["Uint32Array", n => new Uint32Array(n)], ["Float32Array", n => new Float32Array(n)], ["Float64Array", n => new Float64Array(n)],
    ["BigInt64Array", n => new BigInt64Array(n)], ["BigUint64Array", n => new BigUint64Array(n)], ["Buffer", n => Buffer.alloc(n)],
];
for (const [name, make] of kinds) {
    shelf.view = make(5);
    const isBig = name.startsWith("Big");
    for (let n = 0; n < 5; n++) shelf.view[n] = isBig ? BigInt(n * 3 - 2 < 0 ? 0 : n * 3 - 2) : n * 3 - 2 + (name.startsWith("Float") ? 0.5 : 0);
    const [first, , third, , , sixth] = shelf.view;
    attempt(name, () => walk(shelf.view) + " " + walk(shelf.view.values()) + " " + walk(shelf.view.keys()) + " " + walk(shelf.view.entries()) + " " + [...shelf.view].length + " " + Array.from(shelf.view).length + " " + first + "," + third + "," + sixth);
    shelf.view = make(0);
    attempt(name + ", empty", () => walk(shelf.view) + " " + walk(shelf.view.entries()));
}

class Below extends Uint16Array {}
shelf.view = new Below([7, 8, 9]);
attempt("a class below", () => walk(shelf.view) + " " + walk(shelf.view.keys()));
shelf.view = new Uint8Array(new Uint8Array([1, 2, 3, 4, 5, 6]).buffer, 2, 3);
attempt("a window", () => walk(shelf.view) + " " + walk(shelf.view.entries()));

for (const way of ["itself", "values", "keys", "entries"]) {
    const of = (view: any) => way === "itself" ? view : view[way]();
    shelf.view = new Uint8Array([1, 2, 3, 4]);
    attempt("the memory is handed on behind the second step, " + way, () => walk(of(shelf.view), step => { if (step === 1) shelf.view.buffer.transfer(); }));
    attempt("and it is iterated again, " + way, () => walk(of(shelf.view)));

    let buffer = new (ArrayBuffer as any)(8, { maxByteLength: 16 });
    shelf.view = new Uint8Array(buffer); shelf.view.set([1, 2, 3, 4, 5, 6, 7, 8]);
    attempt("follows a buffer that grows, " + way, () => walk(of(shelf.view), step => { if (step === 2) buffer.resize(11); }));
    attempt("follows a buffer that shrinks, " + way, () => walk(of(shelf.view), step => { if (step === 2) buffer.resize(4); }));
    attempt("follows a buffer that shrinks to nothing, " + way, () => walk(of(shelf.view), step => { if (step === 0) buffer.resize(0); }));

    buffer = new (ArrayBuffer as any)(8, { maxByteLength: 16 });
    shelf.view = new Uint8Array(buffer, 2, 4); shelf.view.set([1, 2, 3, 4]);
    attempt("a fixed length, the buffer grows, " + way, () => walk(of(shelf.view), step => { if (step === 1) buffer.resize(16); }));
    attempt("a fixed length, the buffer no longer reaches it, " + way, () => walk(of(shelf.view), step => { if (step === 1) buffer.resize(5); }));
    attempt("and reaches it again, " + way, () => { buffer.resize(8); return walk(of(shelf.view)); });

    buffer = new (ArrayBuffer as any)(8, { maxByteLength: 16 });
    shelf.view = new Uint16Array(buffer, 2); shelf.view.set([1, 2, 3]);
    attempt("follows from a place, the buffer ends in front of it, " + way, () => walk(of(shelf.view), step => { if (step === 0) buffer.resize(1); }));
}

const grows = new (ArrayBuffer as any)(2, { maxByteLength: 8 });
shelf.view = new Uint8Array(grows); shelf.view.set([5, 6]);
const finished = shelf.view.values();
attempt("walked to its end", () => walk(finished));
grows.resize(6);
attempt("what has ended stays ended though the view grew", () => walk(finished) + " " + walk(shelf.view));
const ended = shelf.view.values(); walk(ended); shelf.view.buffer.transfer();
attempt("what has ended throws nothing though the memory went", () => walk(ended));

// The same, stepped by calls of `next` that the program writes itself.
function byHand(iterator: any, atStep?: (step: number) => void): string { let seen = ""; for (let step = 0; step < 40; step++) { const answer = iterator.next(); if (answer.done) return "[" + seen.trim() + "] done " + String(answer.value); seen += answer.value + " "; atStep?.(step); } return "[" + seen.trim() + "] not done"; }
for (const way of ["values", "keys", "entries"]) {
    shelf.view = new Int16Array([-1, 2, -3]);
    attempt("by hand, " + way, () => byHand(shelf.view[way]()));
    shelf.view = new Uint8Array([1, 2, 3, 4]);
    attempt("by hand, the memory is handed on behind the second step, " + way, () => byHand(shelf.view[way](), step => { if (step === 1) shelf.view.buffer.transfer(); }));
    const buffer = new (ArrayBuffer as any)(8, { maxByteLength: 16 });
    shelf.view = new Uint8Array(buffer); shelf.view.set([1, 2, 3, 4, 5, 6, 7, 8]);
    attempt("by hand, follows a buffer that grows, " + way, () => byHand(shelf.view[way](), step => { if (step === 2) buffer.resize(10); }));
    attempt("by hand, follows a buffer that shrinks, " + way, () => byHand(shelf.view[way](), step => { if (step === 2) buffer.resize(4); }));
    shelf.view = new Uint8Array(buffer, 1, 2);
    attempt("by hand, a fixed length, the buffer no longer reaches it, " + way, () => byHand(shelf.view[way](), step => { if (step === 0) buffer.resize(2); }));
}
const spent = new Uint8Array([9]).values(); byHand(spent);
attempt("by hand, what has ended stays ended", () => byHand(spent) + " " + byHand(spent));
for (const line of lines) console.log(line);
