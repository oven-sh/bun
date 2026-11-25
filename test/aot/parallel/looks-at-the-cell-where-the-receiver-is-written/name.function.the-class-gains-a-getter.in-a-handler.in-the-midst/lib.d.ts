export declare class Old { issues: number; constructor(i: number, has?: boolean); size(): number; }
export type Thing = Old;
export function make(i: number, has?: boolean): Thing;
export function read(o: Thing, deed?: (o: Thing) => void): string | Promise<string>;
