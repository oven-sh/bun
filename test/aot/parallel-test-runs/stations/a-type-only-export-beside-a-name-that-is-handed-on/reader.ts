import { fn, type Kind, type Shape } from "./barrel";
import * as all from "./barrel";

const names = all as Record<string, unknown>;

export const read = (): string => fn();
export const readKeys = (): string => Object.keys(all).sort().join("+");
export const readTypes = (): string => [String(names.Shape), String(names.Kind)].join(" ");
export const shapes: Shape[] = [];
export const kinds: Kind[] = [];
