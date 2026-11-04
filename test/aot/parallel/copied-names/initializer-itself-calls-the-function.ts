function outer(): string { try { const held: string = read() + "!"; return held; function read(): string { return typeof held; } } catch (e: any) { return e.constructor.name; } }
console.log(outer());
