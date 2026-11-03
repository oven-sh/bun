import * as self from "./cycle";
export const seen: string[] = [];
for (const attempt of [1, 2]) { try { seen.push(Object.keys({ before: attempt, ...self, after: attempt }).join()); } catch (e) { seen.push((e as Error).name); } }
export const last = 1;
seen.push(Object.keys({ ...self }).join());
