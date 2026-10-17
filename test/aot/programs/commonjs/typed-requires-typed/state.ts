export class Owner { readonly name = "owner"; uses = 0; use(): number { return ++this.uses; } }
export interface Place { readonly start: string; top: string }
export interface Root { readonly owner: Owner; readonly id: string; place: Place | null; readonly notes: string[] }
let binding: Root = { owner: new Owner(), id: "r1", place: { start: "/a", top: "/a/b" }, notes: [] };
export function currentRoot(): Root { return binding; }
export function setRoot(root: Root): void { binding = root; }
export function topOf(root: Root): string | null { return root.place === null ? null : root.place.top; }
export function describe(root: Root): string { return root.id + ":" + root.owner.uses + ":" + topOf(root) + ":" + root.notes.join("+"); }
