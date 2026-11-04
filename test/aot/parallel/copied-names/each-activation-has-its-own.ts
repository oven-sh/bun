function outer(depth: number): string { const mine = "d" + depth; const below = depth ? outer(depth - 1) : ""; return read() + below; function read(): string { return mine; } }
console.log(outer(3));
