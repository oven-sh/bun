// `import T = N.T` where `N.T` is only a type emits no code, even when the namespace contains nothing but types.
namespace local { export type T = number; export interface I { a: T } export namespace types { export type U = string; } }
import T = local.T;
import I = local.I;
import types = local.types;
import U = local.types.U;
const t: T = 1;
const i: I = { a: 2 };
const u: U = "u";
const u2: types.U = "u2";
console.log(t, i.a, u, u2);
