function show(v) {
  return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v);
}
function filled(L, seed, odd) {
  const all = L;
  let state = seed | 0;
  for (let i = 0; i < all.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    all[i] = state >>> 28 === 0 ? odd[(state >>> 8) % odd.length] : (state >> 16) % 100;
  }
  return L;
}
function k0(L, M, n, s, v) {
  let t = 0, u = 0;
  for (let i = 0; i < n; i++) {
    t += L[2 * i];
  }
  return show(t) + " " + u;
}
function k1(L, M, n, s, v) {
  let t = 0, u = 0;
  for (let i = L.length - 1; i >= 0; --i) {
    t = Math.max(t, L[i] + M[i]);
  }
  return show(t) + " " + u;
}
function k2(L, M, n, s, v) {
  let t = 0, u = 0;
  for (let i = 0; i < L.length - 1; i += 1) {
    L[i] = i * v;
  }
  return show(t) + " " + u;
}
function k3(L, M, n, s, v) {
  let t = s, u = 0;
  for (let i = L.length - 1; i >= 3; i--) {
    t += L[i] > v ? 1 : 0;
  }
  return show(t) + " " + u;
}
function k4(L, M, n, s, v) {
  let t = s, u = 0;
  for (let i = L.length - 1; i >= 0; i -= 3) {
    const p = L[i]; u = (u + M[i + 2]) | 0; M[i + 2] = p + 1; t += p + L[i + 1];
  }
  return show(t) + " " + u;
}
function k5(L, M, n, s, v) {
  let t = 0, u = 0;
  for (let i = 1; i < L.length; ++i) {
    t = (t + L[i]) | 0;
  }
  return show(t) + " " + u;
}
console.log("k0", [((L) => { const M = L; return k0(L, M, 4, 1, 7) + "/" + String(L); })(filled(new Int32Array(8), 61, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k0(L, M, 15, 2147483647, 0) + "/" + String(L); })(filled(new Int32Array(15), 107, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k0(L, M, 1, 9007199254740992, 0) + "/" + String(L); })(filled(new Int32Array(0), 928, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k0(L, M, 65, 1, -0) + "/" + String(L); })(filled(new Int32Array(65), 268, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k0(L, M, 33, 1, 128) + "/" + String(L); })(filled(new Int32Array(33), 266, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k0(L, M, 65, 9007199254740992, -1) + "/" + String(L); })(filled(new Int32Array(65), 547, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295]))].join(" "));
console.log("k1", [((L) => { const M = L.subarray(4); return k1(L, M, 33, NaN, 128) + "/" + String(L) + "/" + String(M); })(filled(new Uint8Array(33), 759, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = filled(new Uint8Array(33), 498, [1, 2, 255]); return k1(L, M, 7, 0, 0) + "/" + String(L) + "/" + String(M); })(filled(new Uint8Array(7), 20, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = filled(new Uint8Array(9), 886, [1, 2, 255]); return k1(L, M, 5, NaN, 1) + "/" + String(L) + "/" + String(M); })(filled(new Uint8Array(5), 739, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = new Uint8Array(L.buffer, 1); return k1(L, M, 46, 2147483647, -0) + "/" + String(L) + "/" + String(M); })(filled(new Uint8Array(47), 986, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295]))].join(" "));
console.log("k2", [((L) => { const M = L; return k2(L, M, 1, 0, -0) + "/" + String(L); })(filled(new Int8Array(0), 807, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k2(L, M, 9, 2147483647, 0.5) + "/" + String(L); })(filled(new Int8Array(9), 402, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k2(L, M, 8, -0, 1) + "/" + String(L); })(filled(new Int8Array(9), 411, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k2(L, M, 4, -2147483648, -1) + "/" + String(L); })(filled(new Int8Array(4), 341, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k2(L, M, 9, 0.5, 255) + "/" + String(L); })(filled(new Int8Array(7), 372, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295]))].join(" "));
console.log("k3", [((L) => { const M = L; return k3(L, M, 101, -2147483648, 0) + "/" + String(L); })(filled(new Uint16Array(100), 367, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k3(L, M, 3, 1e21, 255) + "/" + String(L); })(filled(new Uint16Array(2), 781, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k3(L, M, 65, 1e21, 128) + "/" + String(L); })(filled(new Uint16Array(65), 714, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k3(L, M, 33, -2147483648, 128) + "/" + String(L); })(filled(new Uint16Array(33), 171, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295]))].join(" "));
console.log("k4", [((L) => { const M = L; return k4(L, M, 64, 1, NaN) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(65), 885, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L.subarray(2); return k4(L, M, 9, 2147483647, 0) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(9), 961, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = filled(new Int16Array(2), 398, [1, 2, 255]); return k4(L, M, 3, 0, NaN) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(3), 831, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k4(L, M, 38, 2147483647, 255) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(33), 427, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = [5, 6, 7, 8, 9, 10, 11, 12, 13]; return k4(L, M, 9, 3, 1) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(9), 77, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = [0.5, 1.5, 2.5, 3.5]; return k4(L, M, 12, 4, 2) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(12), 78, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]; return k4(L, M, 10, 5, 3) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(10), 79, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = []; return k4(L, M, 7, 6, 4) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(7), 80, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = Array.from({ length: 34 }, (unused, at) => at * 7 + 1); return k4(L, M, 30, 30, 1) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(30), 120, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = Array.from({ length: 45 }, (unused, at) => at * 7 + 1); return k4(L, M, 41, 41, 1) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(41), 131, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = Array.from({ length: 56 }, (unused, at) => at * 7 + 1); return k4(L, M, 52, 52, 1) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(52), 142, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = Array.from({ length: 67 }, (unused, at) => at * 7 + 1); return k4(L, M, 63, 63, 1) + "/" + String(L) + "/" + String(M); })(filled(new Int16Array(63), 153, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295]))].join(" "));
console.log("k5", [((L) => { const M = L; return k5(L, M, 2, 1e21, 7) + "/" + String(L); })(filled(new Int32Array(2), 232, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k5(L, M, 32, 2147483647, 0.5) + "/" + String(L); })(filled(new Int32Array(33), 156, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k5(L, M, 33, 0, 0.5) + "/" + String(L); })(filled(new Int32Array(33), 158, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k5(L, M, 63, -0, 255) + "/" + String(L); })(filled(new Int32Array(64), 950, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k5(L, M, 32, 0, NaN) + "/" + String(L); })(filled(new Int32Array(65), 713, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k5(L, M, 8, 0, 255) + "/" + String(L); })(filled(new Int32Array(17), 832, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295])), ((L) => { const M = L; return k5(L, M, 30, 2147483647, 255) + "/" + String(L); })(filled(new Int32Array(31), 284, [2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295]))].join(" "));

export {};
