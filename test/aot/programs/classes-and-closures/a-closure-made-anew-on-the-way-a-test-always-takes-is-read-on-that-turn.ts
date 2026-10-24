// On every turn a test that always holds chooses between a closure made on that turn and one made before the loop.
type Read = () => number;
const kept: Read[] = [];
function readerOf(value: number): Read { return () => value; }
function t1(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = (i ^ i) === 0 ? readerOf(i) : other; seen.push(read()); } return seen; }
function t2(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = (i - i) === 0 ? readerOf(i) : other; seen.push(read()); } return seen; }
function t3(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = (i & 0) === 0 ? readerOf(i) : other; seen.push(read()); } return seen; }
function t4(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = ((i | 1) & 1) === 1 ? readerOf(i) : other; seen.push(read()); } return seen; }
function t5(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = ((i >>> 1) << 1) <= i ? readerOf(i) : other; seen.push(read()); } return seen; }
function t6(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = (i * 2 - i - i) === 0 ? readerOf(i) : other; seen.push(read()); } return seen; }
function t7(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = ((i << 1) & 1) === 0 ? readerOf(i) : other; seen.push(read()); } return seen; }
function t8(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = (~i ^ ~i) === 0 ? readerOf(i) : other; seen.push(read()); } return seen; }
function t9(n: number) { const other = readerOf(99); kept.push(other); const seen: number[] = []; for (let i = 0; i < n; i++) { const read = ((i & 7) >>> 3) === 0 ? readerOf(i) : other; seen.push(read()); } return seen; }
function once() { return [t1(3), t2(3), t3(3), t4(3), t5(3), t6(3), t7(3), t8(3), t9(3)].map(String).join(" | "); }
console.log(once());
let last = "";
for (let turn = 0; turn < 200; turn++) last = once();
console.log(last, kept.length);
