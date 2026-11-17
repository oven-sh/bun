// Closures, objects and lists born in a loop before inner loops and needed behind them in some arms.
// STATISTIC: AllocationsSunk >= 45
class Pair {
  a;
  b;
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
  sum() {
    return this.a + this.b;
  }
}
const list = [4, 1, 3, 0, 2];
const text = "ab\xE9";
const held = [];
let kept = [];
let later = null;
function keep(v) {
  if (kept.length < 40)
    kept.push(v);
  if (kept.length > 1 && kept[0] === kept[1])
    tell("same");
}
function late(v) {
  later = v;
}
function same(a, b) {
  return a === b;
}
function mix(h, v) {
  const t = typeof v === "number" ? v : 13;
  return (Math.imul(h, 33) + t | 0) & 16777215;
}
function take(v) {
  if (typeof v === "function") {
    const t = v(3);
    return typeof t === "number" ? t : 7;
  }
  if (Array.isArray(v))
    return v.length * 3 + (typeof v[0] === "function" ? v[0]() : v[0]);
  if (v instanceof Pair)
    return v.sum();
  if (v && typeof v === "object") {
    let s = 1;
    for (const k of Object.keys(v)) {
      const w = v[k];
      s = s * 5 + (typeof w === "function" ? w() : typeof w === "number" ? w : take(w));
    }
    return s | 0;
  }
  return 2;
}
let said = [];
function tell(s) {
  said.push(s);
}
let total = 0;
function finish(name, a) {
  let s = String(typeof a === "object" || typeof a === "function" ? "o" + take(a) : a);
  for (const v of kept)
    s += "," + take(v);
  for (const v of held)
    s += ";" + take(v);
  if (later)
    s += "!" + take(later);
  console.log(name, s.slice(0, 200), said.length);
  kept = [];
  held.length = 0;
  later = null;
  said = [];
  total++;
}
function run(name, f) {
  let a;
  try {
    a = f();
  } catch (e) {
    a = "!" + (e && e.message);
  }
  finish(name, a);
}
async function runLater(name, f) {
  let a;
  try {
    a = await f();
  } catch (e) {
    a = "!" + (e && e.message);
  }
  finish(name, a);
}
function* f0(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = [() => k, { x }];
      let s = 0;
      for (let j = 0;j < 3; j++)
        for (let m = 0;m < j; m++)
          s += m + x;
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    } else {
      const b = [() => k, { x }];
      let s = 0;
      for (let j = 0;j < 3; j++)
        for (let m = 0;m < j; m++)
          s += m + x;
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    }
  yield r;
}
run("f0", () => {
  let t = 0;
  for (const v of f0(2, 4))
    t = mix(t, v);
  return t;
});
async function f1(x, n) {
  let r = 1;
  await null;
  for (let k = 0;k < 6; k++) {
    const b = [() => k, { x }];
    let s = 0;
    out:
      for (let j = 0;j < 4; j++)
        for (const v of list) {
          if (v === j)
            continue out;
          s += v;
        }
    if (s < 0)
      return b;
    if (k === 3)
      for (const v of list)
        r = mix(r, take(b) + v);
  }
  return r;
}
await runLater("f1", () => f1(2, 4));
function f2(x, n) {
  let r = 1;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = new Pair(x, k);
      let s = 0;
      out:
        for (let j = 0;j < 4; j++)
          for (const v of list) {
            if (v === j)
              continue out;
            s += v;
          }
      try {
        if (k === 4)
          throw b;
      } catch (e) {
        r = mix(r, take(e));
      }
    }
  return r;
}
run("f2", () => f2(2, 4));
run("f2b", () => f2(3, 0));
function* f3(x, n) {
  let r = 1;
  yield r;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = [x, k, x + 1];
      let s = 0;
      out:
        for (let j = 0;j < 4; j++)
          for (const v of list) {
            if (v === j)
              continue out;
            s += v;
          }
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
    }
  yield r;
}
run("f3", () => {
  let t = 0;
  for (const v of f3(2, 4))
    t = mix(t, v);
  return t;
});

class K_f4 {
  m(x, n) {
    let r = 1;
    for (let k = 0;k < 6; k++) {
      const b = [() => k, { x }];
      let s = 0;
      for (const c of text)
        s += c.length;
      if (s > 3 && same(b, b))
        r = mix(r, 5);
    }
    return r;
  }
}
run("f4", () => new K_f4().m(2, 4));
function f5(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = { get v() {
      return x;
    }, k };
    let s = 0;
    for (let j = 0;j < n; j++)
      s += typeof b === "function" ? j : j + 1;
    switch (k % 3) {
      case 0:
        r = mix(r, take(b));
        break;
      case 1:
        keep(b);
        break;
      default:
        r = mix(r, s);
    }
  }
  return r;
}
run("f5", () => f5(2, 4));
run("f5b", () => f5(3, 0));
function* f6(x, n) {
  let r = 1;
  yield r;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = () => x + k;
    let s = 0;
    let j = 0;
    while (j < 5) {
      s += j;
      if (s > 7)
        break;
      j++;
    }
    if (k === 1)
      late(b);
    r = mix(r, s);
    if (k === 3)
      for (const v of list)
        r = mix(r, take(b) + v);
  }
  yield r;
}
run("f6", () => {
  let t = 0;
  for (const v of f6(2, 4))
    t = mix(t, v);
  return t;
});
function f7(x, n) {
  let r = 1;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = { get v() {
        return x;
      }, k };
      let s = list.reduce((a, v) => a + v, 0);
      if (s < 0)
        return b;
    }
  return r;
}
run("f7", () => f7(2, 4));
run("f7b", () => f7(3, 0));
function f8(x, n) {
  let r = 1;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = new Pair(x, k);
      let s = list.reduce((a, v) => a + v, 0);
      r = mix(r, s);
      if (k === 5) {
        b.extra = k;
        keep(b);
      }
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
    }
  return r;
}
run("f8", () => f8(2, 4));
run("f8b", () => f8(3, 0));
function f9(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = () => x + k;
    let s = 0;
    for (let j = 0;j < 3; j++)
      for (let m = 0;m < j; m++)
        s += m + x;
    r = mix(r, s);
    if (k === 5) {
      b.extra = k;
      keep(b);
    }
  }
  return r;
}
run("f9", () => f9(2, 4));
run("f9b", () => f9(3, 0));
function* f10(x, n) {
  let r = 1;
  yield r;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = { v: x, f: () => k + x };
      let s = 0;
      for (const v of list)
        s += v;
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    }
  yield r;
}
run("f10", () => {
  let t = 0;
  for (const v of f10(2, 4))
    t = mix(t, v);
  return t;
});
async function f11(x, n) {
  let r = 1;
  await null;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    let y = k;
    const b = () => y++;
    let s = 0;
    try {
      for (let j = 0;j < 4; j++) {
        if (j === k)
          throw j;
        s += j;
      }
    } catch (e) {
      s += 100;
    }
    if (k === 1)
      late(b);
    r = mix(r, s);
    if (s > 3 && same(b, b))
      r = mix(r, 5);
  }
  return r;
}
await runLater("f11", () => f11(2, 4));
const f12 = (x, n) => {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = function() {
      return this ? this.q : k;
    };
    let s = list.filter((v) => v > k).length;
    if (s > 9)
      r = mix(r, take(b));
    if (k === 3)
      for (const v of list)
        r = mix(r, take(b) + v);
  }
  return r;
};
run("f12", () => f12(2, 4) + f12(5, 1));
function f13(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = (z) => z * 2;
    let s = 0;
    try {
      for (let j = 0;j < 4; j++) {
        if (j === k)
          throw j;
        s += j;
      }
    } catch (e) {
      s += 100;
    }
    switch (k % 3) {
      case 0:
        r = mix(r, take(b));
        break;
      case 1:
        keep(b);
        break;
      default:
        r = mix(r, s);
    }
  }
  return r;
}
run("f13", () => f13(2, 4));
run("f13b", () => f13(3, 0));

class K_f14 {
  m(x, n) {
    let r = 1;
    for (let q = 0;q < 3; q++)
      for (let k = q;k < 5; k++) {
        const c = { x };
        const b = { c, k };
        let s = 0;
        for (let j = 0;j < n; j++)
          s += typeof b === "function" ? j : j + 1;
        if (k === 3)
          keep(b);
        if (s > 9)
          r = mix(r, take(b));
      }
    return r;
  }
}
run("f14", () => new K_f14().m(2, 4));

class K_f15 {
  m(x, n) {
    let r = 1;
    for (let k = 0;k < 6; k++)
      if (k === 5 && x > 2) {
        const b = [() => k, { x }];
        let s = 0;
        for (const v of list)
          s += v;
        if (s > 3 && same(b, b))
          r = mix(r, 5);
        if (k === 2) {
          const t2 = b;
          for (let j = 0;j < 2; j++)
            r = mix(r, take(t));
        }
      } else {
        const b = [() => k, { x }];
        let s = 0;
        for (const v of list)
          s += v;
        if (s > 3 && same(b, b))
          r = mix(r, 5);
        if (k === 2) {
          const t2 = b;
          for (let j = 0;j < 2; j++)
            r = mix(r, take(t));
        }
      }
    return r;
  }
}
run("f15", () => new K_f15().m(2, 4));
const f16 = (x, n) => {
  let r = 1;
  let k = 0;
  while (k < 6) {
    const b = { v: { w: x }, l: [k] };
    let s = 0;
    for (let j = 0;j < 3; j++)
      for (let m = 0;m < j; m++)
        s += m + x;
    if (k === 1)
      late(b);
    r = mix(r, s);
    if (k === 3)
      keep(b);
    k++;
  }
  return r;
};
run("f16", () => f16(2, 4) + f16(5, 1));
function* f17(x, n) {
  let r = 1;
  yield r;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = [x, k, x + 1];
      let s = 0;
      try {
        for (let j = 0;j < 4; j++) {
          if (j === k)
            throw j;
          s += j;
        }
      } catch (e) {
        s += 100;
      }
      try {
        if (k === 4)
          throw b;
      } catch (e) {
        r = mix(r, take(e));
      }
      if (k === 3)
        keep(b);
    }
  yield r;
}
run("f17", () => {
  let t = 0;
  for (const v of f17(2, 4))
    t = mix(t, v);
  return t;
});
function* f18(x, n) {
  let r = 1;
  yield r;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = { v: { w: x }, l: [k] };
      let s = 0;
      for (let j = 0;j < n; j++)
        s += typeof b === "function" ? j : j + 1;
      if (s > 9)
        r = mix(r, take(b));
      if (s > 3 && same(b, b))
        r = mix(r, 5);
    }
  yield r;
}
run("f18", () => {
  let t = 0;
  for (const v of f18(2, 4))
    t = mix(t, v);
  return t;
});
async function f19(x, n) {
  let r = 1;
  await null;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = () => x + k;
    let s = 0;
    for (const v of list)
      s += v;
    if (s > 9)
      r = mix(r, take(b));
  }
  return r;
}
await runLater("f19", () => f19(2, 4));
async function f20(x, n) {
  let r = 1;
  await null;
  let k = 0;
  while (k < 6) {
    const b = () => x + k;
    let s = 0;
    for (let j = 0;j < n; j++)
      s += j * x;
    if (s < 0)
      return b;
    k++;
  }
  return r;
}
await runLater("f20", () => f20(2, 4));
function f21(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const c = { x };
      const b = { c, k };
      let s = 0;
      for (const c of text)
        s += c.length;
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
    } else {
      const c = { x };
      const b = { c, k };
      let s = 0;
      for (const c of text)
        s += c.length;
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
    }
  return r;
}
run("f21", () => f21(2, 4));
run("f21b", () => f21(3, 0));
const f22 = (x, n) => {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = () => x + k;
    let s = list.filter((v) => v > k).length;
    if (k === 3)
      for (const v of list)
        r = mix(r, take(b) + v);
  }
  return r;
};
run("f22", () => f22(2, 4) + f22(5, 1));
async function f23(x, n) {
  let r = 1;
  await null;
  for (let k = 0;k < 6; k++) {
    const b = { v: x, k };
    let s = 0;
    for (const v of list)
      s += v;
    if (s < 0)
      return b;
  }
  return r;
}
await runLater("f23", () => f23(2, 4));
function f24(x, n) {
  let r = 1;
  let k = 0;
  while (k < 6) {
    const b = (z) => z * 2;
    let s = 0;
    for (const v of list)
      s += v;
    if (k % 4 === 1)
      held.push(b);
    if (k % 4 === 2)
      r = mix(r, take(b));
    r = mix(r, s);
    if (k === 5) {
      b.extra = k;
      keep(b);
    }
    k++;
  }
  return r;
}
run("f24", () => f24(2, 4));
run("f24b", () => f24(3, 0));
async function f25(x, n) {
  let r = 1;
  await null;
  for (let k = 0;k < 6; k++) {
    const c = { x };
    const b = { c, k };
    let s = list.filter((v) => v > k).length;
    r = mix(r, s);
    if (k === 5) {
      b.extra = k;
      keep(b);
    }
    if (s > 9)
      r = mix(r, take(b));
  }
  return r;
}
await runLater("f25", () => f25(2, 4));
function* f26(x, n) {
  let r = 1;
  yield r;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = {};
      b.v = x;
      b.k = k;
      let s = 0;
      for (const v of list)
        s += v;
      r = mix(r, s > 5 ? take(b) : 1);
    }
  yield r;
}
run("f26", () => {
  let t = 0;
  for (const v of f26(2, 4))
    t = mix(t, v);
  return t;
});

class K_f27 {
  m(x, n) {
    let r = 1;
    for (let k = 0;k < 6; k++) {
      let y = k;
      const b = () => y++;
      let s = 0;
      for (let j = 0;j < n; j++)
        s += j * x;
      if (k === 1)
        late(b);
      r = mix(r, s);
    }
    return r;
  }
}
run("f27", () => new K_f27().m(2, 4));
function* f28(x, n) {
  let r = 1;
  yield r;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const c = { x };
    const b = { c, k };
    let s = 0;
    for (const v of list)
      s += v;
    switch (k % 3) {
      case 0:
        r = mix(r, take(b));
        break;
      case 1:
        keep(b);
        break;
      default:
        r = mix(r, s);
    }
    r = mix(r, s);
    if (k === 5) {
      b.extra = k;
      keep(b);
    }
  }
  yield r;
}
run("f28", () => {
  let t = 0;
  for (const v of f28(2, 4))
    t = mix(t, v);
  return t;
});
function f29(x, n) {
  let r = 1;
  [0, 1, 2, 3, 4, 5].forEach((k) => {
    const b = () => x + k;
    let s = list.map((v) => v * 2)[k % 3];
    try {
      if (k === 4)
        throw b;
    } catch (e) {
      r = mix(r, take(e));
    }
  });
  return r;
}
run("f29", () => f29(2, 4));
run("f29b", () => f29(3, 0));

class K_f30 {
  m(x, n) {
    let r = 1;
    for (let k = 0;k < 6; k++)
      if (k === 5 && x > 2) {
        const b = [x, k, x + 1];
        let s = 0;
        for (let j = 0;j < n; j++) {
          if (j === 2)
            keep(b);
          s += j;
        }
        if (s > 9)
          r = mix(r, take(b));
        if (k === 3)
          for (const v of list)
            r = mix(r, take(b) + v);
      } else {
        const b = [x, k, x + 1];
        let s = 0;
        for (let j = 0;j < n; j++) {
          if (j === 2)
            keep(b);
          s += j;
        }
        if (s > 9)
          r = mix(r, take(b));
        if (k === 3)
          for (const v of list)
            r = mix(r, take(b) + v);
      }
    return r;
  }
}
run("f30", () => new K_f30().m(2, 4));
async function f31(x, n) {
  let r = 1;
  await null;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = [x, k, x + 1];
      let s = 0;
      list.forEach((v) => {
        s += v;
      });
      if (s % 2)
        r = mix(r, take(b));
      else
        r = mix(r, s);
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    }
  return r;
}
await runLater("f31", () => f31(2, 4));

class K_f32 {
  m(x, n) {
    let r = 1;
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const b = { v: { w: x }, l: [k] };
      let s = 0;
      out:
        for (let j = 0;j < 4; j++)
          for (const v of list) {
            if (v === j)
              continue out;
            s += v;
          }
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    }
    return r;
  }
}
run("f32", () => new K_f32().m(2, 4));
async function f33(x, n) {
  let r = 1;
  await null;
  let k = 0;
  while (k < 6) {
    const b = [x, k, x + 1];
    let s = 0;
    for (let j = 0;j < 3; j++)
      for (let m = 0;m < j; m++)
        s += m + x;
    if (k % 4 === 1)
      held.push(b);
    if (k % 4 === 2)
      r = mix(r, take(b));
    k++;
  }
  return r;
}
await runLater("f33", () => f33(2, 4));
const f34 = (x, n) => {
  let r = 1;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = { v: { w: x }, l: [k] };
      let s = 0;
      for (let j = 0;j < n; j++) {
        if (j === 2)
          keep(b);
        s += j;
      }
      if (s > 9)
        r = mix(r, take(b));
    } else {
      const b = { v: { w: x }, l: [k] };
      let s = 0;
      for (let j = 0;j < n; j++) {
        if (j === 2)
          keep(b);
        s += j;
      }
      if (s > 9)
        r = mix(r, take(b));
    }
  return r;
};
run("f34", () => f34(2, 4) + f34(5, 1));
function* f35(x, n) {
  let r = 1;
  yield r;
  let k = 0;
  while (k < 6) {
    const b = { v: x, k };
    let s = 0;
    for (const c of text)
      s += c.length;
    if (k === 2) {
      const t = b;
      for (let j = 0;j < 2; j++)
        r = mix(r, take(t));
    }
    try {
      if (k === 4)
        throw b;
    } catch (e) {
      r = mix(r, take(e));
    }
    k++;
  }
  yield r;
}
run("f35", () => {
  let t = 0;
  for (const v of f35(2, 4))
    t = mix(t, v);
  return t;
});
function f36(x, n) {
  let r = 1;
  [0, 1, 2, 3, 4, 5].forEach((k) => {
    const b = {};
    b.v = x;
    b.k = k;
    let s = 0;
    try {
      for (let j = 0;j < 4; j++) {
        if (j === k)
          throw j;
        s += j;
      }
    } catch (e) {
      s += 100;
    }
    if (k % 4 === 1)
      held.push(b);
    if (k % 4 === 2)
      r = mix(r, take(b));
  });
  return r;
}
run("f36", () => f36(2, 4));
run("f36b", () => f36(3, 0));

class K_f37 {
  m(x, n) {
    let r = 1;
    for (let q = 0;q < 3; q++)
      for (let k = q;k < 5; k++) {
        const b = new Pair(x, k);
        let s = 0;
        for (const c of text)
          s += c.length;
        if (k % 4 === 1)
          held.push(b);
        if (k % 4 === 2)
          r = mix(r, take(b));
      }
    return r;
  }
}
run("f37", () => new K_f37().m(2, 4));
async function f38(x, n) {
  let r = 1;
  await null;
  let k = 0;
  while (k < 6) {
    const b = { v: x, f: () => k + x };
    let s = 0;
    try {
      for (let j = 0;j < 4; j++) {
        if (j === k)
          throw j;
        s += j;
      }
    } catch (e) {
      s += 100;
    }
    if (k === 2) {
      const t = b;
      for (let j = 0;j < 2; j++)
        r = mix(r, take(t));
    }
    r = mix(r, s > 5 ? take(b) : 1);
    k++;
  }
  return r;
}
await runLater("f38", () => f38(2, 4));

class K_f39 {
  m(x, n) {
    let r = 1;
    let k = 0;
    while (k < 6) {
      const b = new Pair(x, k);
      let s = list.reduce((a, v) => a + v, 0);
      if (k === 2) {
        const t = b;
        for (let j = 0;j < 2; j++)
          r = mix(r, take(t));
      }
      if (k === 3)
        keep(b);
      k++;
    }
    return r;
  }
}
run("f39", () => new K_f39().m(2, 4));
function* f40(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++) {
    const b = { v: x, k };
    let s = 0;
    do
      s += 3;
    while (s < x);
    if (s > 3 && same(b, b))
      r = mix(r, 5);
  }
  yield r;
}
run("f40", () => {
  let t = 0;
  for (const v of f40(2, 4))
    t = mix(t, v);
  return t;
});
const f41 = (x, n) => {
  let r = 1;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      let y = k;
      const b = () => y++;
      let s = 0;
      for (let j = 0;j < n; j++) {
        if (j === 2)
          keep(b);
        s += j;
      }
      if (s > 9)
        r = mix(r, take(b));
    } else {
      let y = k;
      const b = () => y++;
      let s = 0;
      for (let j = 0;j < n; j++) {
        if (j === 2)
          keep(b);
        s += j;
      }
      if (s > 9)
        r = mix(r, take(b));
    }
  return r;
};
run("f41", () => f41(2, 4) + f41(5, 1));
const f42 = (x, n) => {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = (z) => z * 2;
    let s = 0;
    let j = 0;
    while (j < 5) {
      s += j;
      if (s > 7)
        break;
      j++;
    }
    if (s > 9)
      r = mix(r, take(b));
  }
  return r;
};
run("f42", () => f42(2, 4) + f42(5, 1));

class K_f43 {
  m(x, n) {
    let r = 1;
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const b = {};
      b.v = x;
      b.k = k;
      let s = 0;
      for (let j = 0;j < n; j++)
        s += typeof b === "function" ? j : j + 1;
      if (k === 3)
        keep(b);
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    }
    return r;
  }
}
run("f43", () => new K_f43().m(2, 4));
function f44(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = () => x + k;
    let s = list.reduce((a, v) => a + v, 0);
    if (k === 2) {
      const t = b;
      for (let j = 0;j < 2; j++)
        r = mix(r, take(t));
    }
    if (k === 2) {
      const t2 = b;
      for (let j = 0;j < 2; j++)
        r = mix(r, take(t));
    }
  }
  return r;
}
run("f44", () => f44(2, 4));
run("f44b", () => f44(3, 0));

class K_f45 {
  m(x, n) {
    let r = 1;
    let k = 0;
    while (k < 6) {
      const b = (z) => z * 2;
      let s = 0;
      for (const c of text)
        s += c.length;
      try {
        if (k === 4)
          throw b;
      } catch (e) {
        r = mix(r, take(e));
      }
      r = mix(r, s);
      if (k === 5) {
        b.extra = k;
        keep(b);
      }
      k++;
    }
    return r;
  }
}
run("f45", () => new K_f45().m(2, 4));
async function f46(x, n) {
  let r = 1;
  await null;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = [() => k, { x }];
    let s = 0;
    for (let j = 0;j < 3; j++)
      for (let m = 0;m < j; m++)
        s += m + x;
    if (k === 3)
      for (const v of list)
        r = mix(r, take(b) + v);
    r = mix(r, s > 5 ? take(b) : 1);
  }
  return r;
}
await runLater("f46", () => f46(2, 4));
function* f47(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = (z) => z * 2;
      let s = list.filter((v) => v > k).length;
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    } else {
      const b = (z) => z * 2;
      let s = list.filter((v) => v > k).length;
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    }
  yield r;
}
run("f47", () => {
  let t = 0;
  for (const v of f47(2, 4))
    t = mix(t, v);
  return t;
});
const f48 = (x, n) => {
  let r = 1;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = function() {
        return this ? this.q : k;
      };
      let s = 0;
      out:
        for (let j = 0;j < 4; j++)
          for (const v of list) {
            if (v === j)
              continue out;
            s += v;
          }
      r = mix(r, s > 5 ? take(b) : 1);
    }
  return r;
};
run("f48", () => f48(2, 4) + f48(5, 1));
function* f49(x, n) {
  let r = 1;
  yield r;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = { v: x, k };
    let s = 0;
    list.forEach((v) => {
      s += v;
    });
    if (s < 0)
      yield take(b);
  }
  yield r;
}
run("f49", () => {
  let t = 0;
  for (const v of f49(2, 4))
    t = mix(t, v);
  return t;
});
function* f50(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const c = { x };
      const b = { c, k };
      let s = 0;
      for (let j = 0;j < n; j++)
        s += j * x;
      if (k === 1)
        late(b);
      r = mix(r, s);
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
    } else {
      const c = { x };
      const b = { c, k };
      let s = 0;
      for (let j = 0;j < n; j++)
        s += j * x;
      if (k === 1)
        late(b);
      r = mix(r, s);
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
    }
  yield r;
}
run("f50", () => {
  let t = 0;
  for (const v of f50(2, 4))
    t = mix(t, v);
  return t;
});
const f51 = (x, n) => {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = { v: x, f: () => k + x };
    let s = 0;
    for (const c of text)
      s += c.length;
    if (s > 3 && same(b, b))
      r = mix(r, 5);
  }
  return r;
};
run("f51", () => f51(2, 4) + f51(5, 1));
function f52(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = {};
      b.v = x;
      b.k = k;
      let s = 0;
      list.forEach((v) => {
        s += v;
      });
      r = mix(r, s);
      if (k === 5) {
        b.extra = k;
        keep(b);
      }
    } else {
      const b = {};
      b.v = x;
      b.k = k;
      let s = 0;
      list.forEach((v) => {
        s += v;
      });
      r = mix(r, s);
      if (k === 5) {
        b.extra = k;
        keep(b);
      }
    }
  return r;
}
run("f52", () => f52(2, 4));
run("f52b", () => f52(3, 0));
async function f53(x, n) {
  let r = 1;
  await null;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = { v: x, f: () => k + x };
      let s = list.map((v) => v * 2)[k % 3];
      if (k === 2) {
        const t = b;
        for (let j = 0;j < 2; j++)
          r = mix(r, take(t));
      }
    }
  return r;
}
await runLater("f53", () => f53(2, 4));
function f54(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = { get v() {
      return x;
    }, k };
    let s = 0;
    do
      s += 3;
    while (s < x);
    if (s > 3 && same(b, b))
      r = mix(r, 5);
  }
  return r;
}
run("f54", () => f54(2, 4));
run("f54b", () => f54(3, 0));
function* f55(x, n) {
  let r = 1;
  yield r;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const b = [() => k, { x }];
      let s = 0;
      try {
        for (let j = 0;j < 4; j++) {
          if (j === k)
            throw j;
          s += j;
        }
      } catch (e) {
        s += 100;
      }
      switch (k % 3) {
        case 0:
          r = mix(r, take(b));
          break;
        case 1:
          keep(b);
          break;
        default:
          r = mix(r, s);
      }
    }
  yield r;
}
run("f55", () => {
  let t = 0;
  for (const v of f55(2, 4))
    t = mix(t, v);
  return t;
});

class K_f56 {
  m(x, n) {
    let r = 1;
    for (let q = 0;q < 3; q++)
      for (let k = q;k < 5; k++) {
        const b = {};
        b.v = x;
        b.k = k;
        let s = 0;
        for (let j = 0;j < n; j++)
          s += typeof b === "function" ? j : j + 1;
        if (k % 4 === 1)
          held.push(b);
        if (k % 4 === 2)
          r = mix(r, take(b));
        r = mix(r, s > 5 ? take(b) : 1);
      }
    return r;
  }
}
run("f56", () => new K_f56().m(2, 4));
function* f57(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++) {
    const b = [x, k, x + 1];
    let s = 0;
    for (let j = 0;j < n; j++)
      s += typeof b === "function" ? j : j + 1;
    r = mix(r, s > 5 ? take(b) : 1);
  }
  yield r;
}
run("f57", () => {
  let t = 0;
  for (const v of f57(2, 4))
    t = mix(t, v);
  return t;
});
function f58(x, n) {
  let r = 1;
  [0, 1, 2, 3, 4, 5].forEach((k) => {
    const b = { get v() {
      return x;
    }, k };
    let s = list.reduce((a, v) => a + v, 0);
    if (s > 3 && same(b, b))
      r = mix(r, 5);
  });
  return r;
}
run("f58", () => f58(2, 4));
run("f58b", () => f58(3, 0));
function f59(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = { v: { w: x }, l: [k] };
    let s = 0;
    for (let j = 0;j < n; j++)
      s += typeof b === "function" ? j : j + 1;
    switch (k % 3) {
      case 0:
        r = mix(r, take(b));
        break;
      case 1:
        keep(b);
        break;
      default:
        r = mix(r, s);
    }
  }
  return r;
}
run("f59", () => f59(2, 4));
run("f59b", () => f59(3, 0));
async function f60(x, n) {
  let r = 1;
  await null;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = { v: x, f: () => k + x };
      let s = 0;
      for (const c of text)
        s += c.length;
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
    } else {
      const b = { v: x, f: () => k + x };
      let s = 0;
      for (const c of text)
        s += c.length;
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
    }
  return r;
}
await runLater("f60", () => f60(2, 4));
const f61 = (x, n) => {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = {};
    b.v = x;
    b.k = k;
    let s = 0;
    for (let j = 0;j < 3; j++)
      for (let m = 0;m < j; m++)
        s += m + x;
    if (k === 3)
      keep(b);
  }
  return r;
};
run("f61", () => f61(2, 4) + f61(5, 1));
async function f62(x, n) {
  let r = 1;
  await null;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = () => x + k;
      let s = list.reduce((a, v) => a + v, 0);
      if (s > 3 && same(b, b))
        r = mix(r, 5);
    } else {
      const b = () => x + k;
      let s = list.reduce((a, v) => a + v, 0);
      if (s > 3 && same(b, b))
        r = mix(r, 5);
    }
  return r;
}
await runLater("f62", () => f62(2, 4));

class K_f63 {
  m(x, n) {
    let r = 1;
    for (let k = 0;k < 6; k++) {
      const b = { v: x, k };
      let s = 0;
      for (const c of text)
        s += c.length;
      try {
        if (k === 4)
          throw b;
      } catch (e) {
        r = mix(r, take(e));
      }
    }
    return r;
  }
}
run("f63", () => new K_f63().m(2, 4));
const f64 = (x, n) => {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = {};
    b.v = x;
    b.k = k;
    let s = 0;
    for (let j = 0;j < 3; j++)
      for (let m = 0;m < j; m++)
        s += m + x;
    r = mix(r, s > 5 ? take(b) : 1);
  }
  return r;
};
run("f64", () => f64(2, 4) + f64(5, 1));
const f65 = (x, n) => {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = [x, k, x + 1];
    let s = list.reduce((a, v) => a + v, 0);
    r = mix(r, s > 5 ? take(b) : 1);
  }
  return r;
};
run("f65", () => f65(2, 4) + f65(5, 1));
const f66 = (x, n) => {
  let r = 1;
  let k = 0;
  while (k < 6) {
    const b = (z) => z * 2;
    let s = 0;
    for (let j = 0;j < 3; j++)
      for (let m = 0;m < j; m++)
        s += m + x;
    if (k % 4 === 1)
      held.push(b);
    if (k % 4 === 2)
      r = mix(r, take(b));
    k++;
  }
  return r;
};
run("f66", () => f66(2, 4) + f66(5, 1));
function f67(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = {};
    b.v = x;
    b.k = k;
    let s = 0;
    try {
      for (let j = 0;j < 4; j++) {
        if (j === k)
          throw j;
        s += j;
      }
    } catch (e) {
      s += 100;
    }
    if (s % 2)
      r = mix(r, take(b));
    else
      r = mix(r, s);
  }
  return r;
}
run("f67", () => f67(2, 4));
run("f67b", () => f67(3, 0));
function* f68(x, n) {
  let r = 1;
  yield r;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = function() {
      return this ? this.q : k;
    };
    let s = list.filter((v) => v > k).length;
    if (s % 2)
      r = mix(r, take(b));
    else
      r = mix(r, s);
  }
  yield r;
}
run("f68", () => {
  let t = 0;
  for (const v of f68(2, 4))
    t = mix(t, v);
  return t;
});
function* f69(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = {};
      b.v = x;
      b.k = k;
      let s = 0;
      for (let j = 0;j < 3; j++)
        for (let m = 0;m < j; m++)
          s += m + x;
      if (s > 9)
        r = mix(r, take(b));
      r = mix(r, s > 5 ? take(b) : 1);
    } else {
      const b = {};
      b.v = x;
      b.k = k;
      let s = 0;
      for (let j = 0;j < 3; j++)
        for (let m = 0;m < j; m++)
          s += m + x;
      if (s > 9)
        r = mix(r, take(b));
      r = mix(r, s > 5 ? take(b) : 1);
    }
  yield r;
}
run("f69", () => {
  let t = 0;
  for (const v of f69(2, 4))
    t = mix(t, v);
  return t;
});
const f70 = (x, n) => {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = function() {
      return this ? this.q : k;
    };
    let s = 0;
    for (const v of list)
      s += v;
    if (k === 3)
      for (const v of list)
        r = mix(r, take(b) + v);
    switch (k % 3) {
      case 0:
        r = mix(r, take(b));
        break;
      case 1:
        keep(b);
        break;
      default:
        r = mix(r, s);
    }
  }
  return r;
};
run("f70", () => f70(2, 4) + f70(5, 1));

class K_f71 {
  m(x, n) {
    let r = 1;
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const b = {};
      b.v = x;
      b.k = k;
      let s = 0;
      for (const v of list)
        s += v;
      if (s < 0)
        return b;
    }
    return r;
  }
}
run("f71", () => new K_f71().m(2, 4));
function f72(x, n) {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = (z) => z * 2;
    let s = list.reduce((a, v) => a + v, 0);
    if (k === 1)
      late(b);
    r = mix(r, s);
  }
  return r;
}
run("f72", () => f72(2, 4));
run("f72b", () => f72(3, 0));

class K_f73 {
  m(x, n) {
    let r = 1;
    for (let k = 0;k < 6; k++) {
      const b = function() {
        return this ? this.q : k;
      };
      let s = 0;
      try {
        for (let j = 0;j < 4; j++) {
          if (j === k)
            throw j;
          s += j;
        }
      } catch (e) {
        s += 100;
      }
      if (s > 3 && same(b, b))
        r = mix(r, 5);
      if (s > 3 && same(b, b))
        r = mix(r, 5);
    }
    return r;
  }
}
run("f73", () => new K_f73().m(2, 4));
async function f74(x, n) {
  let r = 1;
  await null;
  [0, 1, 2, 3, 4, 5].forEach((k) => {
    const b = (z) => z * 2;
    let s = 0;
    for (let j = 0;j < n; j++)
      s += j * x;
    r = mix(r, s > 5 ? take(b) : 1);
  });
  return r;
}
await runLater("f74", () => f74(2, 4));
async function f75(x, n) {
  let r = 1;
  await null;
  let k = 0;
  while (k < 6) {
    const b = { v: { w: x }, l: [k] };
    let s = 0;
    for (let j = 0;j < n; j++)
      s += typeof b === "function" ? j : j + 1;
    if (k === 1)
      late(b);
    r = mix(r, s);
    k++;
  }
  return r;
}
await runLater("f75", () => f75(2, 4));
async function f76(x, n) {
  let r = 1;
  await null;
  [0, 1, 2, 3, 4, 5].forEach((k) => {
    const c = { x };
    const b = { c, k };
    let s = 0;
    for (let j = 0;j < n; j++)
      s += typeof b === "function" ? j : j + 1;
    if (s > 3 && same(b, b))
      r = mix(r, 5);
    r = mix(r, s);
    if (k === 5) {
      b.extra = k;
      keep(b);
    }
  });
  return r;
}
await runLater("f76", () => f76(2, 4));
function* f77(x, n) {
  let r = 1;
  yield r;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = [() => k, { x }];
    let s = 0;
    try {
      for (let j = 0;j < 4; j++) {
        if (j === k)
          throw j;
        s += j;
      }
    } catch (e) {
      s += 100;
    }
    if (k === 1)
      late(b);
    r = mix(r, s);
  }
  yield r;
}
run("f77", () => {
  let t = 0;
  for (const v of f77(2, 4))
    t = mix(t, v);
  return t;
});
function* f78(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++) {
    const b = new Pair(x, k);
    let s = 0;
    for (let j = 0;j < n; j++)
      s += typeof b === "function" ? j : j + 1;
    if (s > 9)
      r = mix(r, take(b));
    switch (k % 3) {
      case 0:
        r = mix(r, take(b));
        break;
      case 1:
        keep(b);
        break;
      default:
        r = mix(r, s);
    }
  }
  yield r;
}
run("f78", () => {
  let t = 0;
  for (const v of f78(2, 4))
    t = mix(t, v);
  return t;
});
const f79 = (x, n) => {
  let r = 1;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = { get v() {
        return x;
      }, k };
      let s = list.reduce((a, v) => a + v, 0);
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
      if (k === 3)
        keep(b);
    } else {
      const b = { get v() {
        return x;
      }, k };
      let s = list.reduce((a, v) => a + v, 0);
      if (k === 3)
        for (const v of list)
          r = mix(r, take(b) + v);
      if (k === 3)
        keep(b);
    }
  return r;
};
run("f79", () => f79(2, 4) + f79(5, 1));
function* f80(x, n) {
  let r = 1;
  yield r;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    let y = k;
    const b = () => y++;
    let s = 0;
    let j = 0;
    while (j < 5) {
      s += j;
      if (s > 7)
        break;
      j++;
    }
    r = mix(r, s > 5 ? take(b) : 1);
  }
  yield r;
}
run("f80", () => {
  let t = 0;
  for (const v of f80(2, 4))
    t = mix(t, v);
  return t;
});
const f81 = (x, n) => {
  let r = 1;
  let k = 0;
  while (k < 6) {
    const b = { get v() {
      return x;
    }, k };
    let s = list.map((v) => v * 2)[k % 3];
    if (s % 2)
      r = mix(r, take(b));
    else
      r = mix(r, s);
    if (k === 1)
      late(b);
    r = mix(r, s);
    k++;
  }
  return r;
};
run("f81", () => f81(2, 4) + f81(5, 1));
const f82 = (x, n) => {
  let r = 1;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = [x, k, x + 1];
      let s = 0;
      for (let j = 0;j < n; j++)
        s += j * x;
      r = mix(r, s > 5 ? take(b) : 1);
    } else {
      const b = [x, k, x + 1];
      let s = 0;
      for (let j = 0;j < n; j++)
        s += j * x;
      r = mix(r, s > 5 ? take(b) : 1);
    }
  return r;
};
run("f82", () => f82(2, 4) + f82(5, 1));
const f83 = (x, n) => {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = {};
    b.v = x;
    b.k = k;
    let s = 0;
    out:
      for (let j = 0;j < 4; j++)
        for (const v of list) {
          if (v === j)
            continue out;
          s += v;
        }
    if (k === 3)
      keep(b);
    if (k % 4 === 1)
      held.push(b);
    if (k % 4 === 2)
      r = mix(r, take(b));
  }
  return r;
};
run("f83", () => f83(2, 4) + f83(5, 1));

class K_f84 {
  m(x, n) {
    let r = 1;
    for (let q = 0;q < 3; q++)
      for (let k = q;k < 5; k++) {
        const b = function() {
          return this ? this.q : k;
        };
        let s = 0;
        for (const c of text)
          s += c.length;
        r = mix(r, s > 5 ? take(b) : 1);
      }
    return r;
  }
}
run("f84", () => new K_f84().m(2, 4));
function f85(x, n) {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const c = { x };
    const b = { c, k };
    let s = 0;
    let j = 0;
    while (j < 5) {
      s += j;
      if (s > 7)
        break;
      j++;
    }
    try {
      if (k === 4)
        throw b;
    } catch (e) {
      r = mix(r, take(e));
    }
  }
  return r;
}
run("f85", () => f85(2, 4));
run("f85b", () => f85(3, 0));
function* f86(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = { v: x, f: () => k + x };
      let s = list.filter((v) => v > k).length;
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    } else {
      const b = { v: x, f: () => k + x };
      let s = list.filter((v) => v > k).length;
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    }
  yield r;
}
run("f86", () => {
  let t = 0;
  for (const v of f86(2, 4))
    t = mix(t, v);
  return t;
});
function f87(x, n) {
  let r = 1;
  [0, 1, 2, 3, 4, 5].forEach((k) => {
    const b = { v: { w: x }, l: [k] };
    let s = list.reduce((a, v) => a + v, 0);
    try {
      if (k === 4)
        throw b;
    } catch (e) {
      r = mix(r, take(e));
    }
  });
  return r;
}
run("f87", () => f87(2, 4));
run("f87b", () => f87(3, 0));

class K_f88 {
  m(x, n) {
    let r = 1;
    for (let q = 0;q < 3; q++)
      for (let k = q;k < 5; k++) {
        const b = {};
        b.v = x;
        b.k = k;
        let s = 0;
        out:
          for (let j = 0;j < 4; j++)
            for (const v of list) {
              if (v === j)
                continue out;
              s += v;
            }
        if (k === 3)
          keep(b);
      }
    return r;
  }
}
run("f88", () => new K_f88().m(2, 4));
async function f89(x, n) {
  let r = 1;
  await null;
  [0, 1, 2, 3, 4, 5].forEach((k) => {
    const b = [x, k, x + 1];
    let s = 0;
    for (let j = 0;j < 3; j++)
      for (let m = 0;m < j; m++)
        s += m + x;
    if (s > 3 && same(b, b))
      r = mix(r, 5);
  });
  return r;
}
await runLater("f89", () => f89(2, 4));
const f90 = (x, n) => {
  let r = 1;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const c = { x };
    const b = { c, k };
    let s = list.map((v) => v * 2)[k % 3];
    switch (k % 3) {
      case 0:
        r = mix(r, take(b));
        break;
      case 1:
        keep(b);
        break;
      default:
        r = mix(r, s);
    }
  }
  return r;
};
run("f90", () => f90(2, 4) + f90(5, 1));

class K_f91 {
  m(x, n) {
    let r = 1;
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const b = {};
      b.v = x;
      b.k = k;
      let s = list.reduce((a, v) => a + v, 0);
      if (k % 4 === 1)
        held.push(b);
      if (k % 4 === 2)
        r = mix(r, take(b));
    }
    return r;
  }
}
run("f91", () => new K_f91().m(2, 4));
function f92(x, n) {
  let r = 1;
  for (let q = 0;q < 3; q++)
    for (let k = q;k < 5; k++) {
      const c = { x };
      const b = { c, k };
      let s = 0;
      try {
        for (let j = 0;j < 4; j++) {
          if (j === k)
            throw j;
          s += j;
        }
      } catch (e) {
        s += 100;
      }
      if (s % 2)
        r = mix(r, take(b));
      else
        r = mix(r, s);
      switch (k % 3) {
        case 0:
          r = mix(r, take(b));
          break;
        case 1:
          keep(b);
          break;
        default:
          r = mix(r, s);
      }
    }
  return r;
}
run("f92", () => f92(2, 4));
run("f92b", () => f92(3, 0));
async function f93(x, n) {
  let r = 1;
  await null;
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const b = () => x + k;
    let s = 0;
    list.forEach((v) => {
      s += v;
    });
    try {
      if (k === 4)
        throw b;
    } catch (e) {
      r = mix(r, take(e));
    }
  }
  return r;
}
await runLater("f93", () => f93(2, 4));
const f94 = (x, n) => {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = new Pair(x, k);
    let s = 0;
    for (let j = 0;j < n; j++) {
      if (j === 2)
        keep(b);
      s += j;
    }
    r = mix(r, s > 5 ? take(b) : 1);
    if (s < 0)
      return b;
  }
  return r;
};
run("f94", () => f94(2, 4) + f94(5, 1));
function* f95(x, n) {
  let r = 1;
  yield r;
  for (let k = 0;k < 6; k++)
    if (k === 5 && x > 2) {
      const b = { v: x, f: () => k + x };
      let s = list.filter((v) => v > k).length;
      r = mix(r, s > 5 ? take(b) : 1);
    } else {
      const b = { v: x, f: () => k + x };
      let s = list.filter((v) => v > k).length;
      r = mix(r, s > 5 ? take(b) : 1);
    }
  yield r;
}
run("f95", () => {
  let t = 0;
  for (const v of f95(2, 4))
    t = mix(t, v);
  return t;
});

class K_f96 {
  m(x, n) {
    let r = 1;
    for (let q = 0;q < 3; q++)
      for (let k = q;k < 5; k++) {
        const c = { x };
        const b = { c, k };
        let s = 0;
        for (const c of text)
          s += c.length;
        if (s > 3 && same(b, b))
          r = mix(r, 5);
      }
    return r;
  }
}
run("f96", () => new K_f96().m(2, 4));
function f97(x, n) {
  let r = 1;
  for (let k = 0;k < 6; k++) {
    const b = [() => k, { x }];
    let s = 0;
    do
      s += 3;
    while (s < x);
    if (s % 2)
      r = mix(r, take(b));
    else
      r = mix(r, s);
  }
  return r;
}
run("f97", () => f97(2, 4));
run("f97b", () => f97(3, 0));

class K_f98 {
  m(x, n) {
    let r = 1;
    for (let q = 0;q < 3; q++)
      for (let k = q;k < 5; k++) {
        const b = () => x + k;
        let s = 0;
        do
          s += 3;
        while (s < x);
        if (k === 1)
          late(b);
        r = mix(r, s);
      }
    return r;
  }
}
run("f98", () => new K_f98().m(2, 4));
async function f99(x, n) {
  let r = 1;
  await null;
  for (let k = 0;k < 6; k++) {
    const b = { v: { w: x }, l: [k] };
    let s = 0;
    do
      s += 3;
    while (s < x);
    if (k === 3)
      for (const v of list)
        r = mix(r, take(b) + v);
  }
  return r;
}
await runLater("f99", () => f99(2, 4));
console.log(total);

export {};
