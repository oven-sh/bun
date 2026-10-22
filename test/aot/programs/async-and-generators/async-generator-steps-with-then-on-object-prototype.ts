// In the middle of a stream that `for await` or `yield*` of the program steps, the program tries to give Object.prototype a `then`, promises another `constructor` and Promise another
// species, and puts them back two steps later. The producer tries it in the middle of a step, the loop between two steps. Plain Bun takes the changes: every iterator result is then adopted
// through `then`, and every promise that is awaited is asked for its constructor. A compiled program refuses them with a TypeError, because Object.prototype and Promise.prototype are locked
// there (type-rules/new-properties-on-builtin-prototypes, language/promise-and-symbol-constructors-keep-their-members), and the stream goes on as if nobody had tried.
// So the program judges each stream by what became of the change, and all ways of running it print the same. A change that was taken: the loop got what the changed prototype asks for.
// A change that was refused: values and turns of the job queue are those of the untouched stream, which is printed in full.
type Stream = AsyncGenerator<unknown, void, unknown>;
type Resolve = (value: unknown) => void;
type Hook = (index: number) => void;
interface Change {
    title: string;
    // Answers whether the change was taken.
    make: () => boolean;
    undo: () => void;
    replacesResults: boolean;
    wasNoticed: () => boolean;
}
let log: string[] = [];
const out: string[] = [];
let thenCalls = 0, thenReads = 0, constructorReads = 0;
function note(text: string): void {
    log.push(text);
}
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => note(label + i));
    return last;
}
function attempt(change: () => unknown): void {
    try {
        change();
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
    }
}

// What it resolves with inherits nothing, so it is not asked for a `then` in turn.
function adopts(this: { value?: unknown; done?: unknown }, resolve: Resolve): void {
    thenCalls++;
    const replaced = Object.create(null);
    replaced.value = this.done ? undefined : "replaced " + String(this.value);
    replaced.done = this.done;
    resolve(replaced);
}
function Other(): void {}
const objectPrototype = Object.prototype as any;
const promisePrototype = Promise.prototype as any;
const speciesAtTheStart = Object.getOwnPropertyDescriptor(Promise, Symbol.species)!;
const hasThen = (): boolean => Object.hasOwn(Object.prototype, "then");
const hasOtherConstructor = (): boolean => Object.getOwnPropertyDescriptor(Promise.prototype, "constructor")!.value !== Promise;
const hasOtherSpecies = (): boolean => Object.getOwnPropertyDescriptor(Promise, Symbol.species)!.get !== speciesAtTheStart.get;
const dropThen = (): void => attempt(() => delete objectPrototype.then);
const restoreConstructor = (): void => attempt(() => Object.defineProperty(Promise.prototype, "constructor", { value: Promise, writable: true, enumerable: false, configurable: true }));
const restoreSpecies = (): void => attempt(() => Object.defineProperty(Promise, Symbol.species, speciesAtTheStart));

const changes: Change[] = [
    {
        title: "then is assigned",
        make: () => { attempt(() => { objectPrototype.then = adopts; }); return hasThen(); },
        undo: dropThen, replacesResults: true, wasNoticed: () => thenCalls >= 2,
    },
    {
        title: "then is defined",
        make: () => { attempt(() => Object.defineProperty(Object.prototype, "then", { value: adopts, writable: true, enumerable: false, configurable: true })); return hasThen(); },
        undo: dropThen, replacesResults: true, wasNoticed: () => thenCalls >= 2,
    },
    {
        title: "then is defined through Reflect",
        make: () => { attempt(() => Reflect.defineProperty(Object.prototype, "then", { value: adopts, writable: true, enumerable: false, configurable: true })); return hasThen(); },
        undo: dropThen, replacesResults: true, wasNoticed: () => thenCalls >= 2,
    },
    {
        title: "then is a number",
        make: () => { attempt(() => { objectPrototype.then = 5; }); return hasThen(); },
        undo: dropThen, replacesResults: false, wasNoticed: () => true,
    },
    {
        title: "then is a getter",
        make: () => { attempt(() => Object.defineProperty(Object.prototype, "then", { get() { thenReads++; return undefined; }, enumerable: false, configurable: true })); return hasThen(); },
        undo: dropThen, replacesResults: false, wasNoticed: () => thenReads >= 2,
    },
    {
        title: "the constructor of promises is a getter",
        make: () => { attempt(() => Object.defineProperty(Promise.prototype, "constructor", { get() { constructorReads++; return Promise; }, enumerable: false, configurable: true })); return hasOtherConstructor(); },
        undo: restoreConstructor, replacesResults: false, wasNoticed: () => constructorReads >= 1,
    },
    {
        title: "the constructor of promises is another function",
        make: () => { attempt(() => { promisePrototype.constructor = Other; }); return hasOtherConstructor(); },
        undo: restoreConstructor, replacesResults: false, wasNoticed: () => true,
    },
    {
        title: "the species of Promise is another getter",
        make: () => { attempt(() => Object.defineProperty(Promise, Symbol.species, { get() { return Promise; }, configurable: true })); return hasOtherSpecies(); },
        undo: restoreSpecies, replacesResults: false, wasNoticed: () => true,
    },
];

async function* produces(n: number, hook: Hook): Stream {
    for (let i = 0; i < n; i++) { hook(i); note("yields " + i); yield i; }
    note("the producer ends");
}
async function* relays(source: Stream): Stream {
    for await (const x of source) { note("relays " + String(x)); yield x; }
    note("the relay ends");
}
async function* forwards(source: Stream): Stream {
    yield* source;
    note("the forwarder ends");
}
async function consumes(source: Stream, hook: Hook, got: unknown[]): Promise<void> {
    await null;
    for await (const x of source) {
        got.push(x);
        note("got " + String(x));
        hook(got.length);
    }
    note("the loop is through");
}

const doesNothing: Hook = () => {};
async function run(wrap: (source: Stream) => Stream, isMadeByProducer: boolean, jobs: number, change: Change | undefined): Promise<{ wasTaken: boolean; got: unknown[] }> {
    log = [];
    thenCalls = thenReads = constructorReads = 0;
    let wasTaken = false;
    // The results of the values 2 and 3 are made while the change holds.
    const hook: Hook = index => {
        if (change && index === 2) wasTaken = change.make();
        if (change && index === 4) change.undo();
    };
    const got: unknown[] = [];
    try {
        const beside = jobs ? ticker("t", jobs) : undefined;
        await consumes(wrap(produces(6, isMadeByProducer ? hook : doesNothing)), isMadeByProducer ? doesNothing : hook, got);
        await beside;
    } finally {
        change?.undo();
    }
    return { wasTaken, got };
}
function judge(change: Change, wasTaken: boolean, got: unknown[], depth: number, untouched: string): string {
    const replaced = "replaced ".repeat(depth);
    const expected = wasTaken && change.replacesResults ? "0,1," + replaced + "2," + replaced + "3,4,5" : "0,1,2,3,4,5";
    const isRight = got.join() === expected && (wasTaken ? change.wasNoticed() : thenCalls + thenReads + constructorReads === 0 && log.join(" | ") === untouched);
    return isRight ? "the stream is what the prototypes ask for" : "NOT WHAT THE PROTOTYPES ASK FOR, the change was " + (wasTaken ? "taken" : "refused") + ": " + log.join(" | ");
}

const shapes: [string, number, (source: Stream) => Stream][] = [
    ["a loop over a generator", 1, source => source],
    ["a loop over for await over a generator", 2, relays],
    ["a loop over yield* over a generator", 2, forwards],
    ["a loop over a chain of three", 3, source => relays(forwards(source))],
];
const companies: [string, number][] = [["alone", 0], ["beside jobs", 40]];
// All of them ahead of the first change: what plain Bun has once taken it remembers, also when it is put back.
const untouchedStreams = new Map<string, string>();
for (const [shape, , wrap] of shapes) {
    for (const [company, jobs] of companies) {
        await run(wrap, true, jobs, undefined);
        untouchedStreams.set(shape + ", " + company, log.join(" | "));
        out.push(shape + ", " + company + ", untouched: " + log.join(" | "));
    }
}
for (const [shape, depth, wrap] of shapes) {
    for (const [company, jobs] of companies) {
        const untouched = untouchedStreams.get(shape + ", " + company)!;
        for (const change of changes) {
            for (const isMadeByProducer of [true, false]) {
                const { wasTaken, got } = await run(wrap, isMadeByProducer, jobs, change);
                out.push(shape + ", " + company + ", " + change.title + " by " + (isMadeByProducer ? "the producer in the middle of a step" : "the loop between two steps") + ": " + judge(change, wasTaken, got, depth, untouched));
            }
        }
    }
}
out.push("at the end: " + [hasThen(), hasOtherConstructor(), hasOtherSpecies(), Promise.prototype.constructor === Promise].join());
console.log(out.join("\n"));
export {};
