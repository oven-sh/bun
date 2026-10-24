// delete of a member, with a type assertion in or around the operand. Checked or not.
export function f(a: { b?: number }) { delete a.b; }
export function f(a: { b?: number }) { delete (a.b); }
export function f(a: { b?: number }) { delete a!.b; }
export function f(a: unknown) { delete (a as { b?: number }).b; }
export class C { #a: { b?: number } = {}; m() { delete this.#a.b; } }
export class C { #a: { b?: number } = {}; m() { delete this.#a!.b; } }
⏎// @ts-nocheck⏎export function f(a) { delete (a.b as unknown); }
⏎// @ts-nocheck⏎export function f(a) { delete a.b!; }
⏎// @ts-nocheck⏎export function f(a) { delete (a() as unknown); }
