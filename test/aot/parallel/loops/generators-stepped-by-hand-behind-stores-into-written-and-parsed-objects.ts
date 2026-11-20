// Generators that a loop steps by hand, behind stores into objects of which some are written in the file and some are parsed.
// Under: --aot-testing=FailSpeculations: guesses that fail
// Under: --aot-harden=proof-checks: proofs that are checked
// Under: --aot-erase-types: types that say nothing
function* sums(limit: number): Generator<number, number, any> {
    let sum = 0;
    for (let i = 0; i < limit; i++)
        sum += Number(yield sum) || 1;
    return sum;
}

function countsUp(held: any, rounds: number) {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        const it = sums(round);
        held.y = held.inner.z;
        while (true) {
            const step = it.next(held.x++);
            if (step.done)
                break;
            total += step.value;
        }
    }
    return total + JSON.stringify(held);
}

function reckons(held: any, rounds: number) {
    const view = new Float64Array([1, 2, 3, 4]);
    const row = { x: 1, w: 2 };
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        const it = sums(round + 1);
        held.inner.x += view[0] * 2;
        row.x += held.x * 2;
        let step: any;
        while (!(step = it.next(view[round & 3] * held.inner.x)).done) {
            total += step.value * row.x;
            held.y += step.value;
        }
    }
    return total + JSON.stringify(held) + row.x;
}

console.log(countsUp(JSON.parse('{"x":3,"y":2,"inner":{"x":1,"z":3}}'), 3));
console.log(countsUp({ x: 1, y: 2, inner: { x: 1, z: 1 } }, 4));
console.log(countsUp(JSON.parse('{"y":2,"x":"4","inner":{"z":1,"x":2}}'), 3));
console.log(reckons(JSON.parse('{"x":3,"y":2,"inner":{"x":1,"z":3}}'), 3));
console.log(reckons({ x: 1, y: 2, inner: { x: 1, z: 1 } }, 4));
console.log(reckons(JSON.parse('{"y":2,"x":0.5,"inner":{"z":1,"x":2.5}}'), 3));
