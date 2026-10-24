export class Owner { uses = 0; use(): number { return ++this.uses; } }
export interface Root { readonly owner: Owner; readonly id: string }
let held: Root = { owner: new Owner(), id: "first" };
export function kept(): Root { return held; }
export function keep(root: Root): void { held = root; }
export function describe(root: Root): string { return root.id + ":" + root.owner.uses; }
export function twice(n: number): number { return n * 2; }
