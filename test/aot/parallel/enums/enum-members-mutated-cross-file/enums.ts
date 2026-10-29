export enum Color { Red, Green }
export enum Level { Low, High = 10 }
export enum Mode { On = "on", Off = "off" }
export enum Shape { Round, Square, Flat, Tall }
export enum Size { Small = 1, Large = 2 }
export const enum Fixed { One = 1, Two = 2 }
export enum Merged { First = 1 }
export enum Merged { Second = 2 }
export enum ThroughNamespace { Near = 1, Far = 2 }
export enum Keyed { Left = 1, Right = 2 }
export enum Assigned { Up = 1, Down = 2 }
export enum Defined { In = 1, Out = 2 }
export enum Reflected { Open = 1, Shut = 2, Ajar = 3 }
export enum Untouched { One = 1, Two = 2 }
export function colorInside(): Color { return Color.Red; }
export function levelInside(): number { return Level.Low + Level.High; }
export function mergedInside(): number { return Merged.First + Merged.Second; }
