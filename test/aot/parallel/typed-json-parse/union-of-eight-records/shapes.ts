export interface Arrow {
  tag: "arrow";
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g0: number;
}
export interface Func {
  tag: "func";
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g1: number;
}
export interface VarDecl {
  tag: "vardecl";
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g2: number;
}
export interface CallExpr {
  tag: "callexpr";
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g3: number;
}
export interface SwitchData {
  tag: "switchdata";
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g4: number;
}
export interface Method {
  tag: "method";
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g5: number;
}
export interface Getter {
  tag: "getter";
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g6: number;
}
export interface ReduceData {
  tag: "reducedata";
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g7: number;
}
export type Any = Arrow | Func | VarDecl | CallExpr | SwitchData | Method | Getter | ReduceData;
