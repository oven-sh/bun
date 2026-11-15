export interface Thing { issues: number; aborted?: number; }
export function make(i: number, has?: boolean): Thing;
export function read(o: Thing, deed?: (o: Thing) => void): string | Promise<string>;
