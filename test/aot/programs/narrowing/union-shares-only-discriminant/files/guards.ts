import type { All, Deep, I3, Sub6 } from "./nodes";
import { kindOf, lit, parse, parseLit, take, takeDeep } from "./take";
export function isSub6(node: All): node is Sub6 { return node.kind !== "k1" && node.kind !== "k8"; }
export function byGuard(node: All): string { return isSub6(node) ? take(node) : "-"; }
export function byChain(node: All): string { if (node.kind === "k1") return "1"; if (node.kind === "k8") return "8"; return take(node) + takeDeep(node); }
export function single(node: I3): string { return take(node) + takeDeep(node); }
export function deepSingle(node: Deep<I3>): string { return takeDeep(node); }
export function parsed(): string { return take(parse('{"kind":"k4","own4":4}')) + kindOf(parseLit('{"kind":"l2","v2":2}')) + kindOf(lit(3)) + kindOf(lit(5)); }
