import type { All, I7, Sub17, Sub5 } from "./nodes";
import { parse, parse5, take, take5, unknownToAll } from "./take";
export function isSub17(node: All): node is Sub17 { return node.kind !== "k1" && node.kind !== "k2" && node.kind !== "k20"; }
export function byGuard(node: All): string { return isSub17(node) ? take(node) : "-"; }
export function byChain(node: All): string {
    if (node.kind === "k1") return "1";
    if (node.kind === "k2") return "2";
    if (node.kind === "k20") return "20";
    return take(node);
}
export function byCast(node: All): string { const sub = node as Sub17; return take(sub); }
export function byVariable(node: All): string { let sub: Sub17 | undefined; if (isSub17(node)) sub = node; return sub ? take(sub) : "-"; }
export function single(node: I7): string { return take(node); }
export function five(node: Sub5): string { return take(node) + take5(node); }
export function parsed(): string { return take(parse('{"kind":"k4","id":4,"name":"d","own4":4}')) + take5(parse5('{"kind":"k5","id":5,"name":"e","own5":5}')) + take(unknownToAll({ kind: "k6", id: 6, name: "f", own6: 6 })); }
