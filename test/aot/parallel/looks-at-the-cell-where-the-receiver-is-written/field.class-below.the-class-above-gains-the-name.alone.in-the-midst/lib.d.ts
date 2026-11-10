export declare class Node { issues: number; aborted?: number; constructor(i: number, has?: boolean); size(): number; }
export declare class Below extends Node { deep(): number; }
export type Thing = Below;
export function make(i: number, has?: boolean): Thing;
export function read(o: Thing, deed?: (o: Thing) => void): string | Promise<string>;
