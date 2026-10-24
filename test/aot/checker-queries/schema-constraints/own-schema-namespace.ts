// A program's own `namespace Schema` adds no constraint: only `Schema` from "bun" does.
namespace Schema { export type Min<N extends number> = { readonly min?: N }; }
let v1: number & Schema.Min<1>;
export {};
