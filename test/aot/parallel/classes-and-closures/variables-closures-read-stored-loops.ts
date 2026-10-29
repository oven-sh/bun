// Variables that closures read are stored to in loops inside loops around a call with a seldom taken arm.
class Box {
  constructor(
    public n: number,
    public next: Box | null,
  ) {}
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return 7;
    default:
      return value === null ? 11 : value.n | 0;
  }
}
function f4(a: number, b: number): number {
  const spare = new Box(a, null);
  let v0: number = a | 0;
  let v1: number = a | 0;
  let v2: number = a | 0;
  let v3: number = a | 0;
  let v4: number = a | 0;
  let v5: number = a | 0;
  let v6: number = a | 0;
  let v7: number = a | 0;
  const closure0 = (x: number): number => {
    return v1 ^ v6;
  };
  const closure1 = (x: number): number => {
    return v5 ^ v0;
  };
  try {
    for (const each of [v0]) {
      for (const each of [v4]) {
        v2 = each | 0;
        try {
        } finally {
        }
        v6 = Math.imul(v5, v4);
        let c2 = 1;
        L2: while (c2-- > 0) {
          v4 = fold(v5);
        }
        v2 = closure0(v7);
        v5 = v4 > v1 ? v4 : v1;
      }
    }
  } finally {
    v4 = spare.n | 0;
  }
  return (v1 ^ v2 ^ v3 ^ v4 ^ v5 ^ v6 ^ v7) | 0;
}
let hash = 0;
for (let i = 0; i < 20; i++) hash = (Math.imul(hash, 31) + f4(i, i & 63)) | 0;
console.log(hash);
