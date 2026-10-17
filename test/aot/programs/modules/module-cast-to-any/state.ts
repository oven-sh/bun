export interface Owner { readonly name: string; uses: number }
export interface Root { readonly owner: Owner; readonly id: string; readonly notes: string[] }
let binding: Root = { owner: { name: "owner", uses: 0 }, id: "r1", notes: [] };
export function currentRoot(): Root { return binding; }
export function setRoot(root: Root): void { binding = root; }
export function describe(root: Root): string { return root.id + ":" + root.owner.uses + ":" + root.notes.join("+"); }
export const limit = 3;
export let count = 0;
export function bump(): void { count++; }
