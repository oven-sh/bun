// STATISTIC: ClampedCountersEnteringGenericVersions >= 1
// for (j = i; j < i + half; j++) re[j + half] = ..: `half` is a fraction as far as its type says, and the version that tests it for an integer restarts an iteration whose store cannot be done.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v));
const N = 64;
const re = [], im = [], cosT = [], sinT = [];
for (let i = 0; i < N; i++) {
  re.push(Math.sin(i));
  im.push(0.5);
  cosT.push(Math.cos((2 * Math.PI * i) / N));
  sinT.push(Math.sin((2 * Math.PI * i) / N));
}
function fft(re, im) {
  for (let i = 0, j = 0; i < N; i++) {
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    let m = N >> 1;
    while (m >= 1 && j & m) {
      j ^= m;
      m >>= 1;
    }
    j |= m;
  }
  for (let size = 2; size <= N; size *= 2) {
    const half = size / 2, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const tr = re[j + half] * cosT[k] + im[j + half] * sinT[k];
        const ti = im[j + half] * cosT[k] - re[j + half] * sinT[k];
        re[j + half] = re[j] - tr;
        im[j + half] = im[j] - ti;
        re[j] += tr;
        im[j] += ti;
      }
    }
  }
}
function work(r) {
  for (let i = 0; i < N; i++) {
    re[i] = ((i * 37) % 11) * 0.1;
    im[i] = 0;
  }
  fft(re, im);
  return re[3] + im[5];
}
let s = 0;
for (let r = 0; r < 20; r++) s += work(r);
console.log(show(s));
function spread(list, n, divisor) {
  let sum = 0;
  for (let size = 2; size <= n; size *= 2) {
    const half = size / divisor;
    for (let i = 0; i < n; i += size) {
      for (let j = i; j < i + half; j++) {
        list[j + half] = list[j] * 0.5;
        sum += list[j];
      }
    }
  }
  return sum;
}
function spreadKeys(im, re, n, divisor) {
  let sum = 0;
  for (let size = 2; size <= n; size *= 2) {
    const half = size / divisor, step = n / size;
    if (!(half > -50 && half < 50)) break;
    for (let i = 0; i < n; i += size) for (let j = i, k = 0; j <= i + half - 1; j++, k += step) im[k] = re[j + half];
    for (let i = 0; i < n; i += size) for (let j = i, k = 0; j < i + half; j++, k += step) im[k] = re[j + half];
    sum += im[1];
  }
  return sum;
}
const log = [];
const lists = {
  doubles: () => Array.from({ length: 16 }, (_, i) => i + 0.5),
  integers: () => Array.from({ length: 16 }, (_, i) => i * 2),
  short: () => [0.5, 1.5, 2.5],
  holes: () => { const l = Array.from({ length: 16 }, (_, i) => i + 0.25); delete l[5]; return l; },
  texts: () => Array.from({ length: 16 }, (_, i) => (i === 9 ? "x" : i + 0.5)),
  objects: () => Array.from({ length: 16 }, (_, i) => (i === 6 ? { valueOf() { log.push("v"); return 3; } } : i + 0.5)),
  notNumbers: () => Array.from({ length: 16 }, (_, i) => (i % 5 ? i + 0.5 : NaN)),
  setter: () => { const l = Array.from({ length: 16 }, (_, i) => i + 0.5); Object.defineProperty(l, 3, { get: () => 7.5, set(x) { log.push(show(x)); } }); return l; },
  frozen: () => Object.freeze(Array.from({ length: 16 }, (_, i) => i + 0.5)),
  view: () => new Float32Array(16).fill(1.25),
  sparse: () => { const l = [1.5]; l[40] = 2.5; return l; },
};
for (let turn = 0; turn < 2; turn++) {
  for (const key of Object.keys(lists)) {
    for (const divisor of [2, 4, 3, 1, 0.5, -2, NaN, "2"]) {
      const list = lists[key]();
      let said;
      try {
        said = show(spread(list, 16, divisor));
      } catch (e) {
        said = e.constructor.name;
      }
      console.log(turn, key, divisor, said, list.length, Object.keys(list).slice(0, 44).map(k => k + "=" + show(typeof list[k] === "object" ? "o" : list[k])).join());
    }
  }
}
for (const key of Object.keys(lists)) {
  for (const divisor of [2, 3, 1]) {
    const im = lists[key](), re = lists.doubles();
    let said;
    try {
      said = show(spreadKeys(im, re, 16, divisor));
    } catch (e) {
      said = e.constructor.name;
    }
    console.log(key, divisor, said, Array.prototype.map.call(im, v => show(typeof v === "object" ? "o" : v)).join());
  }
}
console.log(log.length, log.slice(0, 9).join());
