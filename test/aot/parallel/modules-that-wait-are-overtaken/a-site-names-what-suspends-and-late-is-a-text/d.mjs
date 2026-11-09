import "./slow.mjs"; import "./reg.mjs";
export function readLate() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return late.length + work; }
export function askGauge() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Gauge(work).read(); }
export function askMark() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof marked.mark + work; }
function Gauge(g) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.g = g + work; }
function marked() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; }
Gauge.prototype.read = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return this.g + work; };
marked.mark = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; };
const late = "five";
