import { Assigned, Color, Defined, Keyed, Level, Reflected, Size, ThroughNamespace, Untouched } from "./enums";
export function readColor(): Color { return Color.Red; }
export function readLevel(): number { return Level.Low + Level["High"]; }
export function castAndStore(): void { (Size as any).Small = 40; (Size as any)["Large"] = 50; }
export function readSize(): number { return Size.Small + Size.Large; }
export function readThroughNamespace(): number { return ThroughNamespace.Near + ThroughNamespace.Far; }
export function readKeyed(): number { return Keyed.Left + Keyed.Right; }
export function readAssigned(): number { return Assigned.Up + Assigned.Down; }
export function readDefined(): number { return Defined.In + Defined.Out; }
export function readReflected(): number { return Reflected.Open + Reflected.Shut; }
export function readUntouched(): number { return Untouched.One + Untouched.Two; }
