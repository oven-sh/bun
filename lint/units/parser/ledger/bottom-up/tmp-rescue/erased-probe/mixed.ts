type A = 1;
const a0 = 1;
interface B {}
function f(x: number): void;
function f(x: string): void;
function f(x: any) {
  type C = 2;
  if (x) { interface D {} }
  try { type E = 3 } catch { type F = 4 } finally { type G = 5 }
  const g = () => { type H = 6; return 1 };
  switch (x) { case 1: type I = 7; break; default: declare const j: number; }
  lbl: type K = 8;
}
namespace NS { export const v = 1; type L = 9; export function h(): void; export function h() {} }
class Cls {
  m(): void;
  m() {}
  static { type M = 10; }
  declare p: number;
  q = 1;
  abstract r: string;
  [k: string]: unknown;
}
namespace a.b { interface X {} }
export declare const z: number;
