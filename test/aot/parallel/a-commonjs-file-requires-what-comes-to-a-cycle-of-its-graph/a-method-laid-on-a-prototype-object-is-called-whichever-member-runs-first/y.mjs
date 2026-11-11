import "./x.mjs";
export function Shape() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.n = 1; }
Shape.prototype.area = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 7; };
globalThis.declared = true;
