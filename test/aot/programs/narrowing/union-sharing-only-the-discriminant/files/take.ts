import type { All, Deep, Lit } from "./nodes";
export function take(node: All): string { return node.kind; }
export function takeDeep(node: Deep<All>): string { return node.kind; }
export function parse(text: string): All { return JSON.parse(text) as All; }
export function lit(n: number): Lit {
    switch (n) {
        case 1: return { kind: "l1", v1: 1 };
        case 2: return { kind: "l2", v2: 2 };
        case 3: return { kind: "l3", v3: 3 };
        case 4: return { kind: "l4", v4: 4 };
        default: return { kind: "l5", v5: 5 };
    }
}
export function parseLit(text: string): Deep<Lit> { return JSON.parse(text) as Deep<Lit>; }
export function kindOf(l: Deep<Lit>): string { return l.kind; }
