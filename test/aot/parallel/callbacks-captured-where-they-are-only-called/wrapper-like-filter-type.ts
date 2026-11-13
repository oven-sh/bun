type Type = { id: number; flags: number; types?: Type[]; origin?: Type };

const Union = 1;
const Never = 2;
const never: Type = { id: 0, flags: Never };

function filter<T>(list: T[], f: (t: T) => boolean): T[] {
    let out: T[] | undefined;
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (f(item)) {
            if (out) out.push(item);
        } else if (!out) out = list.slice(0, i);
    }
    return out || list;
}

function filterType(type: Type, f: (t: Type) => boolean): Type {
    if (type.flags & Union) {
        const types = type.types!;
        const filtered = filter(types, f);
        if (filtered === types) return type;
        const origin = type.origin;
        let keptOfOrigin = 0;
        if (origin && origin.flags & Union) {
            const originTypes = origin.types!;
            const originFiltered = filter(originTypes, t => !!(t.flags & Union) || f(t));
            keptOfOrigin = originFiltered.length;
        }
        const made: Type = { id: type.id * 1000 + filtered.length * 10 + keptOfOrigin, flags: Union, types: filtered };
        return made;
    }
    return type.flags & Never || f(type) ? type : never;
}

function leaf(id: number): Type {
    return { id, flags: 4 };
}

function unionOf(id: number, members: Type[], origin?: Type): Type {
    return { id, flags: Union, types: members, origin };
}

const leaves: Type[] = [];
for (let i = 1; i <= 12; i++) leaves.push(leaf(i));
const inner = unionOf(50, leaves.slice(0, 4));
const origin = unionOf(60, [inner, ...leaves.slice(4, 9)]);
const whole = unionOf(70, leaves.slice(0, 9), origin);

function divisibleBy(type: Type, k: number): Type {
    const result = filterType(type, t => t.id % k === 0);
    return result;
}

function above(type: Type, floor: number, calls: { count: number }): Type {
    const result = filterType(type, t => {
        calls.count++;
        return t.id > floor;
    });
    return result;
}

let sum = 0;
const seen = new Set<Type>();
const calls = { count: 0 };
for (let round = 0; round < 2000; round++) {
    const k = (round % 5) + 1;
    const a = divisibleBy(whole, k);
    const b = above(whole, round % 11, calls);
    const c = divisibleBy(leaves[round % 12], k);
    sum += a.id + b.id + c.id;
    if (round < 20) {
        seen.add(a);
        seen.add(b);
        seen.add(c);
    }
    if (round % 500 === 499) Bun.gc(true);
}

console.log(sum, calls.count, seen.size);
console.log(divisibleBy(whole, 1) === whole, divisibleBy(whole, 2) === whole, divisibleBy(leaves[3], 2) === leaves[3], divisibleBy(leaves[2], 2) === never);
console.log(divisibleBy(whole, 3).types!.map(t => t.id).join(","), divisibleBy(whole, 3).id);
