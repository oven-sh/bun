function up(turns: number, limit: number): number { let x = 9007199254740989, n = 0; while (x < limit && n < turns) { x++; n++; } return x; }
function down(turns: number, limit: number): number { let x = -9007199254740989, n = 0; while (x > limit && n < turns) { x--; n++; } return x; }
function hits(turns: number): number { let x = 9007199254740989, met = 0; for (let i = 0; i < turns; i++) { if (++x === 9007199254740992) met++; } return met; }
function low(turns: number): number { let x = -9007199254740989, met = 0; for (let i = 0; i < turns; i++) { if (--x === -9007199254740992) met++; } return met; }
function bits(turns: number, limit: number): string { let x = 9007199254740989, seen = ""; for (let n = 0; x < limit && n < turns; n++) { x++; seen += (x % 8) + ","; } return seen; }
for (const turns of [0, 1, 2, 3, 4, 5, 6, 7, 20]) console.log(turns, up(turns, Infinity), down(turns, -Infinity), up(turns, 9007199254740991), down(turns, -9007199254740991), hits(turns), low(turns), bits(turns, Infinity));
