export class Options {
  declare host?: string;
  declare port?: number;
  always = 1;
  get computed(): string {
    return "of the class";
  }
  method(): number {
    return 1;
  }
}
export class Packed {
  declare host?: unknown;
  declare port?: unknown;
}
export type Settings = { id: number; host?: string };
export function makeSettings(id: number): Settings {
  return { id };
}
export type Narrow = { id: number };
export type Wider = { id: number; later?: number };
export function makeNarrow(id: number): Narrow {
  return { id };
}
export function asWider(narrow: Narrow): Wider {
  return narrow as Wider;
}
export function laterOf(wider: Wider): number | undefined {
  return wider.later;
}
