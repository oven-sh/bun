interface Caller {
    call(x: number): number;
}

function asObject(f: (x: number) => number): Caller {
    class Holder implements Caller {
        calls = 0;
        call(x: number): number {
            this.calls++;
            return f(x) + this.calls;
        }
        static direct(x: number): number {
            return f(x) * 2;
        }
    }
    const first = Holder.direct(1);
    const holder = new Holder();
    holder.calls = first;
    return holder;
}

function asField(f: (x: number) => number): Caller {
    class Holder implements Caller {
        call = (x: number): number => f(x) - 1;
    }
    return new Holder();
}

function asLiteral(f: (x: number) => number): Caller {
    return {
        call(x: number): number {
            return f(x) + 7;
        },
    };
}

function maker(k: number): Caller[] {
    const a = asObject(x => x * k);
    const b = asField(x => x + k);
    const c = asLiteral(x => x - k);
    return [a, b, c];
}

function twice(f: (x: number) => number): number {
    const t = f(1) + f(2);
    return t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = twice(x => x * salt - depth);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

const callers: Caller[] = [];
for (let i = 0; i < 200; i++) callers.push(...maker(i));
Bun.gc(true);
console.log(overwriteStack(1500, 19));
Bun.gc(true);

let sum = 0;
for (let round = 0; round < 2; round++) {
    for (let i = 0; i < callers.length; i++) sum += callers[i].call(i);
}
const prototypes = new Set<object>();
for (const caller of callers) prototypes.add(Object.getPrototypeOf(caller));
console.log(sum, callers.length, prototypes.size);
console.log(callers[3].call(5), callers[4].call(5), callers[5].call(5), callers[3].call === callers[3].call, callers[3].call === callers[6].call);
