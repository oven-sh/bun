// A loop that counts down and awaits in some turns reads one element twice: the check of the length that the first read has asked in front of the loop is not asked again, and the length is not narrowed again behind it.
//
// STATISTIC: ArrayBoundsChecksHoisted >= 4
// Under: --aot-check=VerifyEachStage: a value that a test narrows stands right behind the branch on that test
const show = value => (Object.is(value, -0) ? '-0' : String(value));
async function carried(a) {
  let s = 0, x;
  for (let n = 3; n >= 0; n--) {
    s = a[n + 1] - (x ?? 0);
    x = a[n + 1];
    if (n === 0) {
      await 0;
    }
  }
  return show(s) + ',' + show(x);
}
async function awaitsInSomeTurns(a, every) {
  let s = 0, x;
  for (let n = a.length - 2; n >= 0; n--) {
    a[n + 1];
    s = a[n + 1];
    if (n % every === 0) x = await n;
  }
  return show(s) + ',' + show(x);
}
async function below(a) {
  let s = '';
  let n = 4;
  while (n >= 1) {
    s += show(a[n - 1] - 1);
    s += show(a[n - 1]);
    if (n === 1) await 0;
    n--;
  }
  return s;
}
async function twoOffsets(a) {
  let s = 0, x = 0, y = 0;
  for (let n = 3; n >= 0; n--) {
    s += a[n + 1];
    x = a[n + 2];
    y += a[n + 1];
    s -= a[n + 2];
    if (globalThis.awaitsNever) await 0;
  }
  return [s, x, y].map(show).join();
}
async function ofView(view) {
  let s = 0, x;
  for (let n = 3; n >= 0; n--) {
    s = view[n + 1] - (x ?? 0);
    x = view[n + 1];
    if (n === 0) await 0;
  }
  return show(s) + ',' + show(x);
}
async function stores(a, b) {
  let s = 0;
  for (let n = 3; n >= 0; n--) {
    s += a[n + 1];
    b[n + 1] = a[n + 1];
    s += b[n + 1];
    if (n === 1) await 0;
  }
  return show(s) + ':' + b.map(show).join();
}
function* steps(a) {
  let s = 0, x;
  for (let n = 3; n >= 0; n--) {
    s = a[n + 1] - (x ?? 0);
    x = a[n + 1];
    if (n === 0) yield s;
  }
  yield show(s) + ',' + show(x);
}
async function growsBehindAwait(a) {
  let s = 0, x;
  for (let n = 5; n >= 0; n--) {
    s += a[n + 1] === undefined ? 100 : a[n + 1];
    x = a[n + 1];
    if (n === 4) {
      await 0;
      a.push(7, 8, 9);
      a[2] = 'changed';
    }
    if (n === 2) a.length = 2;
  }
  return show(s) + ',' + show(x) + ',' + a.length;
}
const lists = [[1, 2, 3, 4, 5], [1.5, 2.5, 3.5, 4.5, 5.5], [1, 'b', 3.5, null, 5], [1, , 3, , 5], [7], [], ['a', 'b', 'c', 'd', 'e'], [-0, 0, NaN, -0, 1]];
for (const list of lists) {
  console.log(await carried(list), await awaitsInSomeTurns(list, 2), await below(list), await twoOffsets(list), await stores(list, [0, 0, 0, 0, 0]), [...steps(list)].join(), await growsBehindAwait(list.slice()));
}
for (const view of [new Float64Array([1, 2, 3, 4, 5]), new Uint8Array(5), new Int32Array([-1, -2, 3, 4, 5]), new Float64Array(2)]) console.log(await ofView(view), await carried(view), [...steps(view)].join());
console.log(await carried('abcde'), await carried({ 1: 2, 2: 3 }), await below('wxyz'));
