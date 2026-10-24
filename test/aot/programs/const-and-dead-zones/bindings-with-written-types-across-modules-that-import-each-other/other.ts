import { count, name, box } from "./main";
function attempt(f: () => unknown): unknown { try { return f(); } catch (e) { return "threw " + (e as Error).constructor.name; } }
export const early: string = [attempt(() => count + 1), attempt(() => name.length), attempt(() => box.v.w)].join("/");
export const later: number = 1;
