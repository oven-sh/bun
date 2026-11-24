let asked = 0;
const odd = [JSON.parse('"4"'), { valueOf() { asked++; return 4; } }, null, undefined, true, [5], 4n];
function turns(n) { let c = 0; for (let i = 0; i < n - 1; i++) c++; return c; }
for (const n of odd) { try { console.log(turns(n), asked); } catch (error) { console.log(error instanceof TypeError, asked); } }
