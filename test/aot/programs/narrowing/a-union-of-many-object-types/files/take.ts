import type { All, Sub5 } from "./nodes";
export function take(node: All): string { return node.kind + node.id + node.name; }
export function take5(node: Sub5): string { return node.kind + node.id; }
export function parse(text: string): All { return JSON.parse(text) as All; }
export function parse5(text: string): Sub5 { const made = JSON.parse(text) as Sub5; return made; }
export function unknownToAll(value: unknown): All { return value as All; }
