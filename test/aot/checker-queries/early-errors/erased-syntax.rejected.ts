// The errors of erased-syntax.accepted.ts in text that reaches JavaScript.
export function f(public: boolean) {}
export function f(arguments: number) {}
export function f(...a: number[], b: string) {}
export function f(...a: number[],) {}
export class C { m(...a: number[], b: string) {} }
export class C { get a(b: number) { return b; } }
export class C { set a(...b: number[]) {} }
⏎// @ts-nocheck⏎export function f(public: boolean) {}
⏎// @ts-nocheck⏎export function f(...a: number[], b: string) {}
