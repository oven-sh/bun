function outer(): string { let n = 1; const a = read(); n = 2; const b = read(); return a + "," + b; function read(): number { return n; } }
console.log(outer());
