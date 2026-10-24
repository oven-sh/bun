export interface I1 { kind: "k1"; own1: number }
export interface I2 { kind: "k2"; own2: number }
export interface I3 { kind: "k3"; own3: number }
export interface I4 { kind: "k4"; own4: number }
export interface I5 { kind: "k5"; own5: number }
export interface I6 { kind: "k6"; own6: number }
export interface I7 { kind: "k7"; own7: number }
export interface I8 { kind: "k8"; own8: number }
export type All = I1 | I2 | I3 | I4 | I5 | I6 | I7 | I8;
export type Sub6 = I2 | I3 | I4 | I5 | I6 | I7;
export type Lit = { kind: "l1"; v1: number } | { kind: "l2"; v2: number } | { kind: "l3"; v3: number } | { kind: "l4"; v4: number } | { kind: "l5"; v5: number };
export type Deep<T> = T extends object ? { readonly [K in keyof T]: Deep<T[K]> } : T;
