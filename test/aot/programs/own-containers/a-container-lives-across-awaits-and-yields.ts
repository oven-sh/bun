// While a function is suspended other code runs. A container that only the suspended function holds is as it was when the function goes on; one that somebody else holds too may not be.
const lines: string[] = [];
const say = (title: string, value: unknown) => lines.push(title + ": " + JSON.stringify(value));
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const loudPush = function (this: number[], value: number) { Array.prototype.push.call(this, -value); return 0; };

async function heldByNobodyElse(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        out.push(i);
        await tick();
    }
    return out;
}

const shelf: { kept?: number[] } = {};
async function heldByAShelfToo(count: number) {
    const out: number[] = [];
    shelf.kept = out;
    for (let i = 0; i < count; i++) {
        out.push(i);
        await tick();
    }
    return out;
}
async function changesWhatIsOnTheShelf() {
    await tick();
    (shelf.kept as number[] & { push: unknown }).push = loudPush;
}

async function putOnTheShelfLate(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        out.push(i);
        if (i === 1) shelf.kept = out;
        await tick();
        await tick();
    }
    return out;
}

function* yieldsItself(count: number): Generator<number[], number[], void> {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        out.push(i);
        if (i === 1) yield out;
    }
    return out;
}

function* yieldsSomethingElse(count: number): Generator<number, number[], void> {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        out.push(i);
        yield i;
    }
    return out;
}

async function* anAsyncGenerator(count: number) {
    const seen = new Set<number>();
    for (let i = 0; i < count; i++) {
        seen.add(i);
        yield seen;
        await tick();
    }
}

async function main() {
    say("held by nobody else", await heldByNobodyElse(3));
    const [first] = await Promise.all([heldByAShelfToo(4), changesWhatIsOnTheShelf()]);
    say("held by a shelf too", first);
    const late = putOnTheShelfLate(4);
    await tick(); await tick(); await tick();
    (shelf.kept as number[] & { push: unknown }).push = loudPush;
    say("put on the shelf in the second turn", await late);

    const generator = yieldsItself(4);
    const yielded = generator.next().value as number[] & { push: unknown };
    yielded.push = loudPush;
    say("a generator yields it", generator.next().value);
    const other = yieldsSomethingElse(3);
    let step = other.next();
    while (!step.done) step = other.next();
    say("a generator yields something else", step.value);

    const sizes: number[] = [];
    for await (const seen of anAsyncGenerator(3)) {
        sizes.push(seen.size);
        if (seen.size === 1) seen.add = function (this: Set<number>, value: number) { return Set.prototype.add.call(this, value + 100), Set.prototype.add.call(this, value + 200); };
    }
    say("an async generator yields it", sizes);
    console.log(lines.join("\n"));
}
main();
