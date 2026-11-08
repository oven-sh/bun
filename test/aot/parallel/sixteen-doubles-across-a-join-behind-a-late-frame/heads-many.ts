function g(v: number): number { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return v * 0.5 + w; }
function h(v: number): number { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return v * 0.25 + w; }
function last(v: number): number { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return v * 2 + w; }

function looped14(k: number, x: number): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const y = x + w * 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13;
  const r = last(s);
  return r * 0.5;
}
function straight14(k: number, x: number): number {
  const y = x + 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13;
  const r = last(s);
  return r * 0.5;
}
function looped15(k: number, x: number): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const y = x + w * 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14;
  const r = last(s);
  return r * 0.5;
}
function straight15(k: number, x: number): number {
  const y = x + 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14;
  const r = last(s);
  return r * 0.5;
}
function looped16(k: number, x: number): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const y = x + w * 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15;
  const r = last(s);
  return r * 0.5;
}
function straight16(k: number, x: number): number {
  const y = x + 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15;
  const r = last(s);
  return r * 0.5;
}
function looped17(k: number, x: number): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const y = x + w * 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5, d16 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = d14 + t; d16 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = d14 + t + t; d16 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15 + d16;
  const r = last(s);
  return r * 0.5;
}
function straight17(k: number, x: number): number {
  const y = x + 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5, d16 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = d14 + t; d16 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = d14 + t + t; d16 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15 + d16;
  const r = last(s);
  return r * 0.5;
}
function looped18(k: number, x: number): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const y = x + w * 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5, d16 = 0.5, d17 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = d14 + t; d16 = d15 + t; d17 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = d14 + t + t; d16 = d15 + t + t; d17 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15 + d16 + d17;
  const r = last(s);
  return r * 0.5;
}
function straight18(k: number, x: number): number {
  const y = x + 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5, d16 = 0.5, d17 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = d14 + t; d16 = d15 + t; d17 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = d14 + t + t; d16 = d15 + t + t; d17 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15 + d16 + d17;
  const r = last(s);
  return r * 0.5;
}
function looped20(k: number, x: number): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const y = x + w * 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5, d16 = 0.5, d17 = 0.5, d18 = 0.5, d19 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = d14 + t; d16 = d15 + t; d17 = d16 + t; d18 = d17 + t; d19 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = d14 + t + t; d16 = d15 + t + t; d17 = d16 + t + t; d18 = d17 + t + t; d19 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15 + d16 + d17 + d18 + d19;
  const r = last(s);
  return r * 0.5;
}
function straight20(k: number, x: number): number {
  const y = x + 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5, d16 = 0.5, d17 = 0.5, d18 = 0.5, d19 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = d14 + t; d16 = d15 + t; d17 = d16 + t; d18 = d17 + t; d19 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = d14 + t + t; d16 = d15 + t + t; d17 = d16 + t + t; d18 = d17 + t + t; d19 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15 + d16 + d17 + d18 + d19;
  const r = last(s);
  return r * 0.5;
}
function looped24(k: number, x: number): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const y = x + w * 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5, d16 = 0.5, d17 = 0.5, d18 = 0.5, d19 = 0.5, d20 = 0.5, d21 = 0.5, d22 = 0.5, d23 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = d14 + t; d16 = d15 + t; d17 = d16 + t; d18 = d17 + t; d19 = d18 + t; d20 = d19 + t; d21 = d20 + t; d22 = d21 + t; d23 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = d14 + t + t; d16 = d15 + t + t; d17 = d16 + t + t; d18 = d17 + t + t; d19 = d18 + t + t; d20 = d19 + t + t; d21 = d20 + t + t; d22 = d21 + t + t; d23 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15 + d16 + d17 + d18 + d19 + d20 + d21 + d22 + d23;
  const r = last(s);
  return r * 0.5;
}
function straight24(k: number, x: number): number {
  const y = x + 0.5;
  let d0 = 0.5, d1 = 0.5, d2 = 0.5, d3 = 0.5, d4 = 0.5, d5 = 0.5, d6 = 0.5, d7 = 0.5, d8 = 0.5, d9 = 0.5, d10 = 0.5, d11 = 0.5, d12 = 0.5, d13 = 0.5, d14 = 0.5, d15 = 0.5, d16 = 0.5, d17 = 0.5, d18 = 0.5, d19 = 0.5, d20 = 0.5, d21 = 0.5, d22 = 0.5, d23 = 0.5;
  if (k === 0) {
    const t = g(y);
    d0 = t; d1 = d0 + t; d2 = d1 + t; d3 = d2 + t; d4 = d3 + t; d5 = d4 + t; d6 = d5 + t; d7 = d6 + t; d8 = d7 + t; d9 = d8 + t; d10 = d9 + t; d11 = d10 + t; d12 = d11 + t; d13 = d12 + t; d14 = d13 + t; d15 = d14 + t; d16 = d15 + t; d17 = d16 + t; d18 = d17 + t; d19 = d18 + t; d20 = d19 + t; d21 = d20 + t; d22 = d21 + t; d23 = 0.25;
  } else if (k === 1) {
    const t = h(y);
    d0 = t; d1 = d0 + t + t; d2 = d1 + t + t; d3 = d2 + t + t; d4 = d3 + t + t; d5 = d4 + t + t; d6 = d5 + t + t; d7 = d6 + t + t; d8 = d7 + t + t; d9 = d8 + t + t; d10 = d9 + t + t; d11 = d10 + t + t; d12 = d11 + t + t; d13 = d12 + t + t; d14 = d13 + t + t; d15 = d14 + t + t; d16 = d15 + t + t; d17 = d16 + t + t; d18 = d17 + t + t; d19 = d18 + t + t; d20 = d19 + t + t; d21 = d20 + t + t; d22 = d21 + t + t; d23 = 0.75;
  } else return y;
  const s = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12 + d13 + d14 + d15 + d16 + d17 + d18 + d19 + d20 + d21 + d22 + d23;
  const r = last(s);
  return r * 0.5;
}
console.log(14, looped14(0, 3.25), looped14(1, 2.25), looped14(2, 1.25), straight14(0, 3.25), straight14(1, 2.25), straight14(2, 1.25));
console.log(15, looped15(0, 3.25), looped15(1, 2.25), looped15(2, 1.25), straight15(0, 3.25), straight15(1, 2.25), straight15(2, 1.25));
console.log(16, looped16(0, 3.25), looped16(1, 2.25), looped16(2, 1.25), straight16(0, 3.25), straight16(1, 2.25), straight16(2, 1.25));
console.log(17, looped17(0, 3.25), looped17(1, 2.25), looped17(2, 1.25), straight17(0, 3.25), straight17(1, 2.25), straight17(2, 1.25));
console.log(18, looped18(0, 3.25), looped18(1, 2.25), looped18(2, 1.25), straight18(0, 3.25), straight18(1, 2.25), straight18(2, 1.25));
console.log(20, looped20(0, 3.25), looped20(1, 2.25), looped20(2, 1.25), straight20(0, 3.25), straight20(1, 2.25), straight20(2, 1.25));
console.log(24, looped24(0, 3.25), looped24(1, 2.25), looped24(2, 1.25), straight24(0, 3.25), straight24(1, 2.25), straight24(2, 1.25));
