export let hookLate = null;
export function setLate(f) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; hookLate = f; return work; }
export let hookGauge = null;
export function setGauge(f) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; hookGauge = f; return work; }
export let hookMark = null;
export function setMark(f) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; hookMark = f; return work; }
