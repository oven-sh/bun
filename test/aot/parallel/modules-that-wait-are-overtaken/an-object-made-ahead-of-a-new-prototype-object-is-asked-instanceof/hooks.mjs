export let hook = null;
export function setHook(f) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; hook = f; return work; }
