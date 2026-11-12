// Quotients by constants rounded down, up and to the nearest, of integers of every sign: clocks, days, grids.
function clock(t: number): string { const s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600) % 24, d = Math.floor(t / 86400); return [d, h, m, s].join(":"); }
function days(y: number, m: number, d: number): number { y -= m <= 2 ? 1 : 0; const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468; }
function cell(x: number, y: number): string { return Math.floor((x | 0) / 16) + "," + Math.ceil((y | 0) / 16) + "," + Math.round((x | 0) / 10) + "," + Math.floor((y | 0) / 7); }
function rows(view: Int32Array): number { let s = 0; for (let i = 0; i < view.length; i++) s = (s * 3 + Math.floor(view[i]! / 10) + Math.ceil(view[i]! / 6)) | 0; return s; }
function wide(x: number): string { const n = Math.round(x); return [Math.floor(n / 1000), Math.ceil(n / 1000), Math.round(n / 1000), Math.floor(n / 86400000), Math.floor(n / -7), Math.ceil(n / -7)].map(v => (Object.is(v, -0) ? "-0" : String(v))).join(); }
for (const t of [0, 1, -1, 59, 60, -60, -61, 3599, -3600, 86399, -86400, 2147483647, -2147483648, 4294967296, -9007199254740991]) console.log(t, clock(t | 0), clock(t), cell(t, -t), wide(t), wide(t * 3 + 0.5));
for (const y of [-401, -400, -1, 0, 1, 1600, 1970, 2000, 2026]) console.log(y, days(y, 1, 1), days(y, 2, 29), days(y, 3, 1), days(y, 12, 31));
console.log(rows(new Int32Array([0, -1, 9, 10, -10, -11, 2147483647, -2147483648, 6, -6, -7])), rows(new Int32Array(0)));
export {};
