// A condition that is always true, an operand that is never reached and `override` where nothing is overridden say nothing about a type: Style, which costs a dependency nothing.
export function half(n: number, label?: string): number { const text = "" + label ?? "none"; return text.length + n / 2; }
export function call(callback: () => void) { if (callback) return 1; return 2; }
export function always() { if ({}) return 1; return 2; }
export function empty(n: number) { if (n); }
class Base {}
export class Derived extends Base { override run() { return 1; } }
export class Alone { override run() { return 1; } }
