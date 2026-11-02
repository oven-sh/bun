// Each function holds another number of integers in registers over three reads of a reference that may be null. The usual way through them calls nothing.
type Link = { x: number; next: Link | null };
function hold4(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold4(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (r ^ (v0 << 0) ^ (v1 << 1) ^ (v2 << 2) ^ (v3 << 3) ^ p ^ (q << 20) ^ (s << 21) ^ (t << 22)) | 0;
}
function hold5(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold5(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (r ^ (v0 << 0) ^ (v1 << 1) ^ (v2 << 2) ^ (v3 << 3) ^ (v4 << 4) ^ p ^ (q << 20) ^ (s << 21) ^ (t << 22)) | 0;
}
function hold6(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold6(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold7(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold7(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold8(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold8(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold9(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold9(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold10(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold10(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold11(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold11(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold12(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold12(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold13(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold13(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const v12 = (v8 + v5 * 29) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      (v12 << 12) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold14(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold14(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const v12 = (v8 + v5 * 29) | 0;
  const v13 = (v9 + v6 * 31) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      (v12 << 12) ^
      (v13 << 13) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold15(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold15(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const v12 = (v8 + v5 * 29) | 0;
  const v13 = (v9 + v6 * 31) | 0;
  const v14 = (v10 + v7 * 37) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      (v12 << 12) ^
      (v13 << 13) ^
      (v14 << 14) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold16(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold16(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const v12 = (v8 + v5 * 29) | 0;
  const v13 = (v9 + v6 * 31) | 0;
  const v14 = (v10 + v7 * 37) | 0;
  const v15 = (v11 + v8 * 41) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      (v12 << 12) ^
      (v13 << 13) ^
      (v14 << 14) ^
      (v15 << 15) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold17(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold17(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const v12 = (v8 + v5 * 29) | 0;
  const v13 = (v9 + v6 * 31) | 0;
  const v14 = (v10 + v7 * 37) | 0;
  const v15 = (v11 + v8 * 41) | 0;
  const v16 = (v12 + v9 * 43) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      (v12 << 12) ^
      (v13 << 13) ^
      (v14 << 14) ^
      (v15 << 15) ^
      (v16 << 16) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold18(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold18(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const v12 = (v8 + v5 * 29) | 0;
  const v13 = (v9 + v6 * 31) | 0;
  const v14 = (v10 + v7 * 37) | 0;
  const v15 = (v11 + v8 * 41) | 0;
  const v16 = (v12 + v9 * 43) | 0;
  const v17 = (v13 + v10 * 47) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      (v12 << 12) ^
      (v13 << 13) ^
      (v14 << 14) ^
      (v15 << 15) ^
      (v16 << 16) ^
      (v17 << 17) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold19(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold19(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const v12 = (v8 + v5 * 29) | 0;
  const v13 = (v9 + v6 * 31) | 0;
  const v14 = (v10 + v7 * 37) | 0;
  const v15 = (v11 + v8 * 41) | 0;
  const v16 = (v12 + v9 * 43) | 0;
  const v17 = (v13 + v10 * 47) | 0;
  const v18 = (v14 + v11 * 53) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      (v12 << 12) ^
      (v13 << 13) ^
      (v14 << 14) ^
      (v15 << 15) ^
      (v16 << 16) ^
      (v17 << 17) ^
      (v18 << 18) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
function hold20(o: Link | null, a: number, b: number, c: number, d: number): number {
  if (d > 1e9) return hold20(o, a, b, c, d - 1);
  const p = a | 0,
    q = b | 0,
    s = c | 0,
    t = d | 0;
  const v0 = (p * 3 + q) | 0;
  const v1 = (q * 5 + s) | 0;
  const v2 = (s * 7 + t) | 0;
  const v3 = (t * 11 + p) | 0;
  const v4 = (v0 ^ (q << 1)) | 0;
  const v5 = (v1 ^ (s << 2)) | 0;
  const v6 = (v2 ^ (t << 3)) | 0;
  const v7 = (v3 ^ (p << 4)) | 0;
  const v8 = (v4 + v1 * 13) | 0;
  const v9 = (v5 + v2 * 17) | 0;
  const v10 = (v6 + v3 * 19) | 0;
  const v11 = (v7 + v4 * 23) | 0;
  const v12 = (v8 + v5 * 29) | 0;
  const v13 = (v9 + v6 * 31) | 0;
  const v14 = (v10 + v7 * 37) | 0;
  const v15 = (v11 + v8 * 41) | 0;
  const v16 = (v12 + v9 * 43) | 0;
  const v17 = (v13 + v10 * 47) | 0;
  const v18 = (v14 + v11 * 53) | 0;
  const v19 = (v15 + v12 * 59) | 0;
  const n1 = o!.next,
    n2 = n1!.next;
  const r = (n2!.x + n1!.x + o!.x) | 0;
  return (
    (r ^
      (v0 << 0) ^
      (v1 << 1) ^
      (v2 << 2) ^
      (v3 << 3) ^
      (v4 << 4) ^
      (v5 << 5) ^
      (v6 << 6) ^
      (v7 << 7) ^
      (v8 << 8) ^
      (v9 << 9) ^
      (v10 << 10) ^
      (v11 << 11) ^
      (v12 << 12) ^
      (v13 << 13) ^
      (v14 << 14) ^
      (v15 << 15) ^
      (v16 << 16) ^
      (v17 << 17) ^
      (v18 << 18) ^
      (v19 << 19) ^
      p ^
      (q << 20) ^
      (s << 21) ^
      (t << 22)) |
    0
  );
}
const functions = [
  hold4,
  hold5,
  hold6,
  hold7,
  hold8,
  hold9,
  hold10,
  hold11,
  hold12,
  hold13,
  hold14,
  hold15,
  hold16,
  hold17,
  hold18,
  hold19,
  hold20,
];
const chains: (Link | null)[] = [null];
for (let length = 1; length <= 3; length++) chains.push({ x: length, next: chains[length - 1] });
for (let round = 0; round < 3; round++) {
  for (const hold of functions) {
    const answers: string[] = [];
    for (const chain of chains) {
      try {
        answers.push(String(hold(chain, round, round + 1, round + 2, round + 3)));
      } catch (error) {
        answers.push(`${error instanceof TypeError}: ${(error as Error).message.split(" (")[0]}`);
      }
    }
    console.log(hold.name, answers.join(" | "));
  }
}
