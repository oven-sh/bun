function* steps(): Generator<number> { const base = 10; yield read(); yield read() + 1; function read(): number { return base; } }
async function later(): Promise<string> { const held = "a"; await null; const more = "b"; return read(); function read(): string { return held + more; } }
console.log([...steps()].join()); later().then(console.log);
