// Inlining in async functions: calls in loops without `await` are inlined, calls outside loops and in loops with `await` are not.
// IR= 0 mixed CallDirect f[0-9]+ \(v[0-9]+, v[0-9]+\)$
// IR= 4 mixed frame [0-9]+ = Mul
declare const console: any;
function add(a: number, b: number): number { return a * 3 + b; }
async function mixed(n: number): Promise<number> {
    let s = add(n, 1);                                              // in front of the first await: a plain function: copied in
    for (let i = 0; i < n; i++) s += add(i, s & 7);                 // a loop that does not suspend: copied in
    for (let i = 0; i < 3; i++) { s += add(i, 2); await undefined; }    // a loop that may go on without suspending: copied in
    return s;
}
mixed(100000).then(r => console.log(r));
export {};
