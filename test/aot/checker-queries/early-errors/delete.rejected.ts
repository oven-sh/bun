// delete of a name or of a private member in parentheses or under a type assertion, and the cases of delete.rejected.js in TypeScript. Checked or not.
let a: unknown; delete (a); export {};
let a: unknown; delete ((a)); export {};
let a: unknown; delete a; export {};
let a; delete (a);
let a: unknown; delete (a as object); export {};
let a: unknown; delete a!; export {};
let a: unknown; delete <object>a; export {};
let a: unknown; delete (a satisfies unknown); export {};
export class C { #a = 1; m() { delete this.#a; } }
export class C { #a = 1; m() { delete (this.#a); } }
export class C { #a = 1; m() { delete (this.#a as unknown); } }
export class C { #a = 1; m() { delete this.#a!; } }
⏎// @ts-nocheck⏎let a; delete (a); export {};
⏎// @ts-nocheck⏎let a; delete (a as object); export {};
⏎// @ts-nocheck⏎let a; delete a!; export {};
⏎// @ts-nocheck⏎export class C { #a = 1; m() { delete (this.#a as unknown); } }
