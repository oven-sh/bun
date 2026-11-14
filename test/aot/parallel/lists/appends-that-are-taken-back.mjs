// A store appends to an array literal and a later guard of the same iteration fails: the array is as long as before.
// STATISTIC: StoresGrowingArrays >= 8
// STATISTIC: StoresUndoneAtIterationRestarts >= 8
// STATISTIC: LoopVersioningAttemptsFailed = 0
function twice(x, w) { const a = []; for (let i = 0; i < x.length; i++) { a[i] = i * 0.5 + w; a[i] = a[i] + x[i]; } return [a]; }
function tables(x) { const a = [0], b = [0]; for (let i = 0; i < x.length; i++) { a[i + 1] = a[i] + x[i]; b[i + 1] = b[i] + x[i] * x[i]; } return [a, b]; }
function reset(x, n) { const a = [0]; for (let i = 0; i < n; i++) { a[i] = 0; for (let j = 0; j < 3; j++) a[i] += x[j + i]; } return [a]; }
function three(x, w) { const a = [1], b = [2], c = [3]; for (let i = 1; i < x.length; i++) { a[i] = x[i]; b[i] = x[i - 1] * w; c[i] = a[i] + b[i - 1]; } return [a, b, c]; }
function whole(x) { const a = [1], b = [1]; for (let i = 1; i < x.length; i++) { a[i] = i * 3; b[i] = (a[i - 1] + x[i]) | 0; } return [a, b]; }
function* yielded(x) { const a = [0], b = [0]; for (let i = 0; i < x.length; i++) { a[i + 1] = a[i] + x[i]; b[i + 1] = b[i] - x[i]; if (i === 2) yield a.length; } yield [a, b]; }
async function awaited(x) { const a = [0], b = [0]; for (let i = 0; i < x.length; i++) { a[i + 1] = a[i] + x[i]; b[i + 1] = x[i] * 2; } await 0; return [a, b]; }
class Holder { both(x) { const a = [0.5], b = [0.5]; for (let i = 0; i < x.length; i++) { a[i] = i; b[i] = a[i] * x[i]; } return [a, b]; } }
let calls = 0;
const show = v => Array.isArray(v) ? v.length + "[" + Array.from({ length: Math.min(v.length, 9) }, (_, i) => (i in v ? show(v[i]) : "_")).join() + "]" + Object.keys(v).length : Object.is(v, -0) ? "-0" : typeof v === "object" ? "o" : String(v);
const long = []; for (let i = 0; i < 90; i++) long.push((i % 7) + 0.5);
const inputs = [[1, 2, 3, 4, 5], [0.5, 1.5, 2.5, 3.5], [1, 2, "t", 4], [1.5, NaN, 2], [1, , 3, 4], [1, undefined, null, 4], [2147483647, 2147483647, 1], [-0, 0, -0], [], long, new Float64Array([1, 2.5, 3]), [1, 2, { valueOf() { calls++; return 7; } }, 4], [1n, 2n], Object.defineProperty([1, 2, 3, 4], 2, { get() { calls++; return 2.5; } }), "1234", [4, 5, long[0], "x"].concat(long)];
for (const x of inputs) {
  for (const [name, run] of Object.entries({ twice: () => twice(x, 0.5), twice2: () => twice(x, NaN), twice3: () => twice(x, "s"), tables: () => tables(x), reset: () => reset(x, 4), reset2: () => reset(x, 40), three: () => three(x, 2), three2: () => three(x, -0), whole: () => whole(x), yielded: () => [...yielded(x)], both: () => new Holder().both(x) })) {
    let said;
    try { said = show(run()); } catch (error) { said = error.constructor.name; }
    console.log(name, said, calls);
  }
  console.log("awaited", await awaited(x).then(show, error => error.constructor.name));
}
