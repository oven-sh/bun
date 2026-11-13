console.log("SAID body");
export enum Color { Red, Green = 5 }
export namespace N { export let v = 1; export const up = () => ++v; }
export const f = () => [Color.Green, N.up(), N.v, Color[0]].join();
export type T = string;
export abstract class Base { abstract go(): void; static who = () => "base"; }
