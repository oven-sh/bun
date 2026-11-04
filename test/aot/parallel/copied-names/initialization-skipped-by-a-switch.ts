function outer(k: number): string { try { switch (k) { case 0: const held = "zero"; return read(); case 1: return read(); } return "none"; function read(): string { return held; } } catch (e: any) { return e.constructor.name; } }
console.log(outer(0), outer(1), outer(2));
