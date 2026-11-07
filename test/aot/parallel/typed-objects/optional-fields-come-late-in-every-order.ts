// Objects whose type has many optional fields get them late, in every kind of order, one by one and several in a row, while collections go by: what lies outside the cell grows where it is or moves,
// and every field keeps its value.
// Flags: --aot-heat=everything-is-hot
interface Late { id: number; f0?: number; f1?: string; f2?: Late; f3?: unknown; f4?: number; f5?: string; f6?: Late; f7?: unknown; f8?: number; f9?: string; f10?: Late; f11?: unknown; f12?: number; f13?: string; f14?: Late; f15?: unknown; f16?: number; f17?: string; f18?: Late; f19?: unknown; f20?: number; f21?: string; f22?: Late; f23?: unknown; f24?: number; f25?: string; }
const opaque = <T>(value: T): T => (Reflect.get({ value }, ["val", "ue"].join("")) as T);
const shared: Late = { id: -1 };
function fill0(o: Late, k: number): void {
  o.f0 = k + 0;
  o.f1 = "s1-" + k;
  o.f2 = shared;
  o.f3 = (k & 1 ? "u3" : 3);
  o.f4 = k + 4;
  o.f5 = "s5-" + k;
  o.f6 = shared;
  o.f7 = (k & 1 ? "u7" : 7);
  if (opaque(k) < 0) return;
  o.f8 = k + 8;
  if (opaque(k) < 0) return;
  o.f9 = "s9-" + k;
  o.f10 = shared;
  o.f11 = (k & 1 ? "u11" : 11);
  o.f12 = k + 12;
  if (opaque(k) < 0) return;
  o.f13 = "s13-" + k;
  o.f14 = shared;
  o.f15 = (k & 1 ? "u15" : 15);
  o.f16 = k + 16;
  o.f17 = "s17-" + k;
  if (opaque(k) < 0) return;
  o.f18 = shared;
  if (opaque(k) < 0) return;
  o.f19 = (k & 1 ? "u19" : 19);
  if (opaque(k) < 0) return;
  o.f20 = k + 20;
  o.f21 = "s21-" + k;
  o.f22 = shared;
  o.f23 = (k & 1 ? "u23" : 23);
  o.f24 = k + 24;
  o.f25 = "s25-" + k;
}
function fill1(o: Late, k: number): void {
  o.f25 = "s25-" + k;
  o.f24 = k + 24;
  if (opaque(k) < 0) return;
  o.f23 = (k & 1 ? "u23" : 23);
  o.f22 = shared;
  o.f21 = "s21-" + k;
  o.f20 = k + 20;
  o.f19 = (k & 1 ? "u19" : 19);
  o.f18 = shared;
  if (opaque(k) < 0) return;
  o.f17 = "s17-" + k;
  o.f16 = k + 16;
  o.f15 = (k & 1 ? "u15" : 15);
  o.f14 = shared;
  o.f13 = "s13-" + k;
  o.f12 = k + 12;
  o.f11 = (k & 1 ? "u11" : 11);
  o.f10 = shared;
  o.f9 = "s9-" + k;
  o.f8 = k + 8;
  o.f7 = (k & 1 ? "u7" : 7);
  o.f6 = shared;
  o.f5 = "s5-" + k;
  o.f4 = k + 4;
  o.f3 = (k & 1 ? "u3" : 3);
  if (opaque(k) < 0) return;
  o.f2 = shared;
  o.f1 = "s1-" + k;
  o.f0 = k + 0;
}
function fill2(o: Late, k: number): void {
  o.f2 = shared;
  o.f10 = shared;
  o.f4 = k + 4;
  o.f12 = k + 12;
  o.f9 = "s9-" + k;
  o.f13 = "s13-" + k;
  o.f25 = "s25-" + k;
  o.f22 = shared;
  if (opaque(k) < 0) return;
  o.f18 = shared;
  o.f24 = k + 24;
  o.f6 = shared;
  o.f3 = (k & 1 ? "u3" : 3);
  o.f17 = "s17-" + k;
  o.f15 = (k & 1 ? "u15" : 15);
  o.f21 = "s21-" + k;
  if (opaque(k) < 0) return;
}
function fill3(o: Late, k: number): void {
  o.f7 = (k & 1 ? "u7" : 7);
  o.f15 = (k & 1 ? "u15" : 15);
  if (opaque(k) < 0) return;
  o.f10 = shared;
  if (opaque(k) < 0) return;
  o.f6 = shared;
  o.f1 = "s1-" + k;
  o.f8 = k + 8;
  o.f9 = "s9-" + k;
  if (opaque(k) < 0) return;
  o.f13 = "s13-" + k;
  o.f25 = "s25-" + k;
  o.f17 = "s17-" + k;
  o.f11 = (k & 1 ? "u11" : 11);
  o.f23 = (k & 1 ? "u23" : 23);
  if (opaque(k) < 0) return;
  o.f20 = k + 20;
  o.f12 = k + 12;
  o.f3 = (k & 1 ? "u3" : 3);
}
function fill4(o: Late, k: number): void {
  o.f15 = (k & 1 ? "u15" : 15);
  o.f7 = (k & 1 ? "u7" : 7);
  if (opaque(k) < 0) return;
  o.f6 = shared;
  o.f22 = shared;
  o.f18 = shared;
  o.f19 = (k & 1 ? "u19" : 19);
  o.f3 = (k & 1 ? "u3" : 3);
  o.f14 = shared;
  o.f12 = k + 12;
  o.f20 = k + 20;
  o.f1 = "s1-" + k;
  o.f21 = "s21-" + k;
  if (opaque(k) < 0) return;
  o.f23 = (k & 1 ? "u23" : 23);
  o.f17 = "s17-" + k;
  o.f16 = k + 16;
  o.f24 = k + 24;
  o.f25 = "s25-" + k;
  o.f10 = shared;
  o.f2 = shared;
  if (opaque(k) < 0) return;
  o.f8 = k + 8;
  o.f4 = k + 4;
  o.f5 = "s5-" + k;
  if (opaque(k) < 0) return;
  o.f13 = "s13-" + k;
  o.f11 = (k & 1 ? "u11" : 11);
  o.f0 = k + 0;
  if (opaque(k) < 0) return;
}
function fill5(o: Late, k: number): void {
  o.f10 = shared;
  if (opaque(k) < 0) return;
  o.f25 = "s25-" + k;
  o.f4 = k + 4;
  o.f14 = shared;
  o.f23 = (k & 1 ? "u23" : 23);
  o.f16 = k + 16;
  o.f6 = shared;
  if (opaque(k) < 0) return;
  o.f24 = k + 24;
  o.f3 = (k & 1 ? "u3" : 3);
  o.f2 = shared;
  o.f15 = (k & 1 ? "u15" : 15);
  o.f7 = (k & 1 ? "u7" : 7);
  o.f19 = (k & 1 ? "u19" : 19);
  o.f18 = shared;
  o.f9 = "s9-" + k;
  o.f20 = k + 20;
  o.f21 = "s21-" + k;
  o.f13 = "s13-" + k;
  o.f17 = "s17-" + k;
}
function fill6(o: Late, k: number): void {
  o.f7 = (k & 1 ? "u7" : 7);
  o.f22 = shared;
  o.f0 = k + 0;
  o.f17 = "s17-" + k;
  o.f15 = (k & 1 ? "u15" : 15);
  o.f12 = k + 12;
  if (opaque(k) < 0) return;
  o.f10 = shared;
  o.f21 = "s21-" + k;
  o.f4 = k + 4;
  o.f20 = k + 20;
  o.f16 = k + 16;
  o.f23 = (k & 1 ? "u23" : 23);
  o.f19 = (k & 1 ? "u19" : 19);
  if (opaque(k) < 0) return;
  o.f25 = "s25-" + k;
  if (opaque(k) < 0) return;
  o.f5 = "s5-" + k;
  o.f6 = shared;
  o.f2 = shared;
  o.f13 = "s13-" + k;
  o.f1 = "s1-" + k;
  o.f9 = "s9-" + k;
  o.f11 = (k & 1 ? "u11" : 11);
  if (opaque(k) < 0) return;
  o.f18 = shared;
  if (opaque(k) < 0) return;
  o.f3 = (k & 1 ? "u3" : 3);
}
function fill7(o: Late, k: number): void {
  o.f16 = k + 16;
  o.f10 = shared;
  o.f21 = "s21-" + k;
  if (opaque(k) < 0) return;
  o.f14 = shared;
  o.f8 = k + 8;
  o.f13 = "s13-" + k;
  if (opaque(k) < 0) return;
  o.f0 = k + 0;
  if (opaque(k) < 0) return;
}
function fill8(o: Late, k: number): void {
  o.f0 = k + 0;
  if (opaque(k) < 0) return;
  o.f12 = k + 12;
  o.f15 = (k & 1 ? "u15" : 15);
  if (opaque(k) < 0) return;
  o.f14 = shared;
  o.f8 = k + 8;
  o.f19 = (k & 1 ? "u19" : 19);
  o.f22 = shared;
  o.f10 = shared;
  o.f17 = "s17-" + k;
  if (opaque(k) < 0) return;
  o.f9 = "s9-" + k;
  o.f7 = (k & 1 ? "u7" : 7);
  o.f2 = shared;
  o.f16 = k + 16;
  o.f6 = shared;
  o.f24 = k + 24;
  o.f1 = "s1-" + k;
  o.f25 = "s25-" + k;
  o.f11 = (k & 1 ? "u11" : 11);
  if (opaque(k) < 0) return;
}
function fill9(o: Late, k: number): void {
  o.f6 = shared;
  o.f23 = (k & 1 ? "u23" : 23);
  o.f18 = shared;
  o.f16 = k + 16;
  if (opaque(k) < 0) return;
  o.f0 = k + 0;
  o.f14 = shared;
  o.f7 = (k & 1 ? "u7" : 7);
  if (opaque(k) < 0) return;
  o.f9 = "s9-" + k;
  o.f1 = "s1-" + k;
  o.f21 = "s21-" + k;
  o.f11 = (k & 1 ? "u11" : 11);
  o.f13 = "s13-" + k;
  if (opaque(k) < 0) return;
  o.f22 = shared;
  o.f8 = k + 8;
  o.f24 = k + 24;
  if (opaque(k) < 0) return;
  o.f19 = (k & 1 ? "u19" : 19);
  o.f2 = shared;
  o.f20 = k + 20;
  if (opaque(k) < 0) return;
}
function fill10(o: Late, k: number): void {
  o.f13 = "s13-" + k;
  o.f17 = "s17-" + k;
  o.f1 = "s1-" + k;
  if (opaque(k) < 0) return;
  o.f3 = (k & 1 ? "u3" : 3);
  o.f6 = shared;
  o.f11 = (k & 1 ? "u11" : 11);
  if (opaque(k) < 0) return;
  o.f2 = shared;
  o.f21 = "s21-" + k;
  if (opaque(k) < 0) return;
  o.f14 = shared;
  o.f16 = k + 16;
  o.f12 = k + 12;
  o.f7 = (k & 1 ? "u7" : 7);
  o.f4 = k + 4;
  o.f20 = k + 20;
  o.f19 = (k & 1 ? "u19" : 19);
  o.f25 = "s25-" + k;
  o.f15 = (k & 1 ? "u15" : 15);
  o.f0 = k + 0;
  o.f18 = shared;
  if (opaque(k) < 0) return;
  o.f5 = "s5-" + k;
  o.f10 = shared;
  o.f9 = "s9-" + k;
  o.f23 = (k & 1 ? "u23" : 23);
  o.f22 = shared;
  o.f24 = k + 24;
}
function fill11(o: Late, k: number): void {
  o.f13 = "s13-" + k;
  o.f0 = k + 0;
  o.f3 = (k & 1 ? "u3" : 3);
  o.f7 = (k & 1 ? "u7" : 7);
  o.f19 = (k & 1 ? "u19" : 19);
  o.f21 = "s21-" + k;
  o.f20 = k + 20;
  o.f12 = k + 12;
  o.f8 = k + 8;
  if (opaque(k) < 0) return;
}
function fill(which: number, o: Late, k: number): void {
  switch (which) {
    case 0: return fill0(o, k);
    case 1: return fill1(o, k);
    case 2: return fill2(o, k);
    case 3: return fill3(o, k);
    case 4: return fill4(o, k);
    case 5: return fill5(o, k);
    case 6: return fill6(o, k);
    case 7: return fill7(o, k);
    case 8: return fill8(o, k);
    case 9: return fill9(o, k);
    case 10: return fill10(o, k);
    case 11: return fill11(o, k);
  }
}
function describe(o: Late): string {
  const parts: string[] = [];
  parts.push(o.f0 === undefined ? "-" : String(o.f0));
  parts.push(o.f1 === undefined ? "-" : String(o.f1));
  parts.push(o.f2 === undefined ? "-" : String(o.f2.id));
  parts.push(o.f3 === undefined ? "-" : String(o.f3));
  parts.push(o.f4 === undefined ? "-" : String(o.f4));
  parts.push(o.f5 === undefined ? "-" : String(o.f5));
  parts.push(o.f6 === undefined ? "-" : String(o.f6.id));
  parts.push(o.f7 === undefined ? "-" : String(o.f7));
  parts.push(o.f8 === undefined ? "-" : String(o.f8));
  parts.push(o.f9 === undefined ? "-" : String(o.f9));
  parts.push(o.f10 === undefined ? "-" : String(o.f10.id));
  parts.push(o.f11 === undefined ? "-" : String(o.f11));
  parts.push(o.f12 === undefined ? "-" : String(o.f12));
  parts.push(o.f13 === undefined ? "-" : String(o.f13));
  parts.push(o.f14 === undefined ? "-" : String(o.f14.id));
  parts.push(o.f15 === undefined ? "-" : String(o.f15));
  parts.push(o.f16 === undefined ? "-" : String(o.f16));
  parts.push(o.f17 === undefined ? "-" : String(o.f17));
  parts.push(o.f18 === undefined ? "-" : String(o.f18.id));
  parts.push(o.f19 === undefined ? "-" : String(o.f19));
  parts.push(o.f20 === undefined ? "-" : String(o.f20));
  parts.push(o.f21 === undefined ? "-" : String(o.f21));
  parts.push(o.f22 === undefined ? "-" : String(o.f22.id));
  parts.push(o.f23 === undefined ? "-" : String(o.f23));
  parts.push(o.f24 === undefined ? "-" : String(o.f24));
  parts.push(o.f25 === undefined ? "-" : String(o.f25));
  return parts.join(",");
}
const kept: Late[] = [];
let hash = 0;
for (let round = 0; round < 4000; round++) {
  const o: Late = { id: round };
  fill(round % 12, o, round);
  if (round % 7 === 0) fill((round * 5 + 3) % 12, o, round + 1);
  if (round % 97 === 0) kept.push(o);
  const text = describe(o);
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  if (round < 14) console.log(text);
}
console.log(hash);
for (const o of kept) console.log(o.id, describe(o), Object.keys(o).join(""));
