function outer(): string { const seen: number[] = []; let n = 0; for (let i = 0; i < 3; i++) { seen.push(read()); n = i + 10; } seen.push(read()); return seen.join(); function read(): number { return n; } }
console.log(outer());
