type Lazy = { readonly value: number; reads: number };

function lazy(f: () => number): Lazy {
    return {
        reads: 0,
        get value(): number {
            this.reads++;
            return f() + this.reads;
        },
    };
}

function lazyOfClass(f: () => number): Lazy {
    class Holder {
        reads = 0;
        get value(): number {
            this.reads++;
            return f() * 2 + this.reads;
        }
    }
    return new Holder();
}

function lazyByDescriptor(f: () => number): Lazy {
    const holder = { reads: 0 } as Lazy;
    Object.defineProperty(holder, "value", { get: () => f() - 1, enumerable: true });
    return holder;
}

function maker(k: number): Lazy[] {
    let calls = 0;
    const a = lazy(() => k + ++calls);
    const b = lazyOfClass(() => k * 3);
    const c = lazyByDescriptor(() => k - 3);
    return [a, b, c];
}

function twice(f: (x: number) => number): number {
    const t = f(1) + f(2);
    return t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = twice(x => x + salt * depth);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

const made: Lazy[] = [];
for (let i = 0; i < 200; i++) made.push(...maker(i));
Bun.gc(true);
console.log(overwriteStack(1500, 23));
Bun.gc(true);

let sum = 0;
for (let round = 0; round < 3; round++) {
    for (const one of made) sum += one.value;
}
console.log(sum, made.length, made[0].reads, made[1].reads, made[2].reads);
console.log(made[3].value, made[4].value, made[5].value, made[597].value, made[598].value, made[599].value);
