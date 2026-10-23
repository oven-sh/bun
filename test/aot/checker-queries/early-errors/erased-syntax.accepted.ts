// TypeScript's errors in a type, in the declaration of a type and in a type parameter. bun run skips that text, so none is an early error, checked or not.
export type F = (public: boolean) => void;
export type F = (arguments: number) => void;
export type F = (await: number) => void;
export type F = (...a: number[], b: string) => void;
export type F = (...a: number[],) => void;
export type F = { new (...a: number[], b: string): object };
export interface I { m(...a: number[], b: string): void; }
export interface I { get a(b: number): number; }
export interface I { set a(...b: number[]); }
export function f<public>() {}
⏎// @ts-nocheck⏎export type F = (public: boolean) => void;
⏎// @ts-nocheck⏎export type F = (await: number) => void;
⏎// @ts-nocheck⏎export type F = (...a: number[], b: string) => void;
