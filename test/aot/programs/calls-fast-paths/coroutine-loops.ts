// Inlining in async functions: an async function stays one function, so a call is inlined once wherever it stands: ahead of the first `await`, in a loop without `await`, in a loop with `await`.
// IR= 0 mixed CallDirect \(v[0-9]+, v[0-9]+\) function=f[0-9]+
// IR= 3 mixed  = Mul .*#[0-9]+$
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
