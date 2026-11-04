// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// A project without strict null checks starts from empty literals.
import { Queue, remember, collect, one, state, either } from "./legacy/empty-literals.ts";
const queue = new Queue();
console.log(queue.add(1), queue.add(2), queue.last, JSON.stringify(queue.items));
console.log(remember(1), remember(2), JSON.stringify(collect(1)), JSON.stringify(collect(2, [1])), JSON.stringify(one(3)));
console.log(JSON.stringify(state(4)), JSON.stringify(either(5, true)), JSON.stringify(either(6, false)));

// FILE: legacy/empty-literals.ts
export class Queue { items = []; last = null; add(n: number): number { this.items.push(n); this.last = n; return this.items.length; } }
export let shared = [];
export function remember(n: number): number { shared.push(n); return shared.length; }
export function collect(n: number, into = []) { into.push(n); return into; }
function empty() { return []; }
export function one(n: number) { const made = empty(); made.push(n); return made; }
export function state(n: number) { const kept = { last: null, list: [] }; kept.last = n; kept.list.push(n); return kept; }
export function either(n: number, c: boolean) { const kept = c ? { last: null } : { list: [] }; if (kept.list) kept.list.push(n); else kept.last = n; return kept; }

// FILE: legacy/tsconfig.json
{ "extends": "../tsconfig.json", "compilerOptions": { "strict": false } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }
