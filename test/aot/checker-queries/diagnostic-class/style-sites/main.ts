const unusedLocal = 1;
type UnusedType = number;
export function unreachable(): number { fail(); called(); }
declare function called(): void;
export function someReturns(flag: boolean) { if (flag) { return 1; } }
export function noReturn(): number {}
export function neverEnds(): never {}
export declare function implicitResult();
export declare class Accessors { set value(value); }
export type Renamed = ({ a: string }: { a: number }) => void;
declare function fail(): never;
