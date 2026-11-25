class Parser { constructor() { this.n = 0; } write(kind, chunk) { for (let i = 0; i < chunk.length; i++) if (chunk[i] === kind) this.n++; return this.n; } }
const p = new Parser(); console.log(p.write(10, Buffer.from([10, 2, 10])), p.write(1, Buffer.from([1])));
