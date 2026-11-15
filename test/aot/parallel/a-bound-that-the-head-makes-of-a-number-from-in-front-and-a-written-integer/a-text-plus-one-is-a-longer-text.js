function turns(n) { let c = 0; for (let i = 0; i < n + 1; i++) { c++; if (c > 50) break; } return c; }
console.log(turns(JSON.parse('"2"')), turns(JSON.parse('2')), turns(JSON.parse('""')));
