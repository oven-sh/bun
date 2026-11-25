function up(turns: number): number { let x = 9007199254740989; for (let i = 0; i < turns; i++) x++; return x; }
function down(turns: number): number { let x = -9007199254740989; for (let i = 0; i < turns; i++) x--; return x; }
function upByOne(turns: number): number { let x = 9007199254740989; for (let i = 0; i < turns; i++) x = x + 1; return x; }
function downByOne(turns: number): number { let x = -9007199254740989; for (let i = 0; i < turns; i++) x = x - 1; return x; }
function both(turns: number): string { let x = 9007199254740990, y = -9007199254740990, seen = ""; for (let i = 0; i < turns; i++) { x++; y--; seen += x + " " + y + " " + (x + y) + ";"; } return seen; }
function meets(turns: number): number { let x = 9007199254740990, met = 0; for (let i = 0; i < turns; i++) { const before = x; x++; if (x === before) met++; } return met; }
for (const turns of [0, 1, 2, 3, 4, 5, 6, 7, 20]) console.log(turns, up(turns), down(turns), upByOne(turns), downByOne(turns), meets(turns));
console.log(both(6));
