import { number, text, flag, nothing, sum, readLater } from "./a";
import * as a from "./a";
function probe(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
export const early: string = [probe(() => number), probe(() => text), probe(() => flag), probe(() => nothing), probe(() => sum), probe(readLater)].join();
export const viaNamespace: string = [probe(() => a.number), probe(() => [a][0].text)].join();
export function late(): string { return [number, text, flag, nothing, sum].join(); }
