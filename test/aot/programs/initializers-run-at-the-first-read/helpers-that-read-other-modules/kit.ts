export const registry: string[] = [];
export class Shape { constructor(public kind: string, public parts: Shape[] = []) {} }
export const DEFAULTS = { depth: 1 };
export function shape(kind: string, ...parts: Shape[]) { return new Shape(kind, parts); }
export function counted(kind: string) { registry.push(kind); return new Shape(kind); }
export function withDefaults(kind: string) { return { kind, depth: DEFAULTS.depth }; }
export let mode = "first";
export function setMode(next: string) { mode = next; }
export function inMode(kind: string) { return { kind, mode }; }
