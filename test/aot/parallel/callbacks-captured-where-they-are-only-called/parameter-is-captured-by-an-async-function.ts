function start(job: () => Promise<number>): Promise<number> {
    const promise = job();
    return promise;
}

function later(f: (x: number) => number): Promise<number> {
    const promise = start(async () => {
        const a = f(1);
        await null;
        const b = f(2);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        return a + b + f(3);
    });
    return promise;
}

async function direct(f: (x: number) => number): Promise<number> {
    const a = f(1);
    await null;
    return a + f(2);
}

function chained(f: (x: number) => number): Promise<number> {
    const promise = Promise.resolve(4).then(x => f(x) + 1);
    return promise;
}

function maker(k: number): Promise<number>[] {
    const a = later(x => x * k);
    const b = direct(x => x + k);
    const c = chained(x => x - k);
    return [a, b, c];
}

function twice(f: (x: number) => number): number {
    const t = f(1) + f(2);
    return t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = twice(x => x + depth - salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

const pending: Promise<number>[] = [];
for (let i = 0; i < 200; i++) pending.push(...maker(i));
Bun.gc(true);
console.log(overwriteStack(1500, 17));
Bun.gc(true);

const answers = await Promise.all(pending);
let sum = 0;
for (const answer of answers) sum += answer;
console.log(sum, answers.length, answers[0], answers[1], answers[2], answers[597], answers[598], answers[599]);
