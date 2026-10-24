export type Schema<T = unknown> = { parse(given: unknown): T }
export function object(shape: Record<string, Schema>): Schema
export function any(): Schema<any>
