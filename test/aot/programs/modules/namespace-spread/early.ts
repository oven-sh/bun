import * as self from "./early";
export const seen: string[] = [];
try { seen.push(JSON.stringify({ ...self })); } catch (e) { seen.push((e as Error).name); }
export const late = 1;
try { seen.push(Object.keys({ ...self }).join()); } catch (e) { seen.push((e as Error).name); }
