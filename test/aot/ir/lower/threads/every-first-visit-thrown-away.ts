// RUN(ONE): link
// ENTRY: app/main.ts
// CWD: app
// OPTIONS: builtin-modules
// OPTIONS(ONE): threads=1
// ONE: function {{*}}name="limitsOf"
// RUN(D1): link
// OPTIONS(D1): threads=1 discards-first-visits
// SAME: ONE D1
// RUN(D2): link
// OPTIONS(D2): threads=2 discards-first-visits
// SAME: ONE D2
// RUN(D3): link
// OPTIONS(D3): threads=3 discards-first-visits
// SAME: ONE D3
// RUN(D4): link
// OPTIONS(D4): threads=4 discards-first-visits
// SAME: ONE D4
// RUN(D6): link
// OPTIONS(D6): threads=6 discards-first-visits
// SAME: ONE D6
// RUN(D8): link
// OPTIONS(D8): threads=8 discards-first-visits
// SAME: ONE D8
// RUN(D12): link
// OPTIONS(D12): threads=12 discards-first-visits
// SAME: ONE D12
// RUN(D16): link
// OPTIONS(D16): threads=16 discards-first-visits
// SAME: ONE D16
// RUN(L1): link
// OPTIONS(L1): threads=1 last-file-first
// SAME: ONE L1
// RUN(L4): link
// OPTIONS(L4): threads=4 last-file-first discards-first-visits
// SAME: ONE L4

// Which visits of a build are thrown away is a matter of the threads' timing. Here every first visit is, on one thread and on many, and the program is what it is without that. A task whose only visit is thrown away lowers nothing: the state that the lowering keeps on its thread goes on to the next task without what was kept by the numbers of that task's rows.

// FILE: app/main.ts
import { limitsOf, isWhole, type Node } from "bounds-kit";
const node: Node = {
  kind: "number",
  inner: { rules: [{ held: { inner: { rule: "above", value: 3, inclusive: true } } }, { held: { inner: { rule: "below", value: 9 } } }] },
};
const limits = limitsOf(node);
console.log(String(limits.low?.value), String(limits.low?.inclusive), String(limits.high?.value), String(limits.high?.inclusive), String(isWhole(node)));

// FILE: app/tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","allowJs":true,"noEmit":true,"skipLibCheck":true}}

// FILE: app/node_modules/bounds-kit/package.json
{ "name": "bounds-kit", "version": "1.0.0", "main": "field.js", "types": "field.d.ts" }

// FILE: app/node_modules/bounds-kit/field.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWhole = isWhole;
exports.limitsOf = limitsOf;
function kindOf(node) {
    return node.kind;
}
function innerOf(node) {
    return node.inner;
}
function isWhole(node) {
    return (kindOf(node) === "number" &&
        node.isWhole === true);
}
function limitsOf(node) {
    var _a;
    if (kindOf(node) !== "number") {
        return { low: undefined, high: undefined };
    }
    let low;
    let high;
    for (const c of (_a = innerOf(node).rules) !== null && _a !== void 0 ? _a : []) {
        const d = c.held.inner;
        if (typeof d.value !== "number") {
            continue;
        }
        if (d.rule === "above") {
            low = { value: d.value, inclusive: d.inclusive === true };
        }
        else if (d.rule === "below") {
            high = { value: d.value, inclusive: d.inclusive === true };
        }
    }
    return { low, high };
}

// FILE: app/node_modules/bounds-kit/field.d.ts
export interface Rule {
    held: { inner: { rule: string; value?: unknown; inclusive?: boolean } };
}
export interface Node {
    kind: string;
    isWhole?: boolean;
    inner: { rules?: Rule[] };
}
export declare function isWhole(node: Node): boolean;
export interface Limit {
    value: number;
    inclusive: boolean;
}
export declare function limitsOf(node: Node): {
    low: Limit | undefined;
    high: Limit | undefined;
};
