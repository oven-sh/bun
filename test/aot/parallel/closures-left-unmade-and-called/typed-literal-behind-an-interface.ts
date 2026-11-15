interface Stepper { next(): number; reset(): void }
function make(): Stepper { let n = 0; return { next: () => { n += 1; return n; }, reset: () => { n = 0; } }; }
function drain(stepper: Stepper, turns: number): number { let total = 0; for (let j = 0; j < turns; j++) total += stepper.next(); return total; }
function run(count: number): number {
    let total = 0;
    for (let k = 0; k < count; k++) {
        const it = make();
        total += it.next();
        total += drain(it, 3);
        it.reset();
        total += it.next();
        const next = it.next;
        total += next() + (next === it.next ? 100 : 0);
    }
    return total;
}
console.log(String(run(30)));
