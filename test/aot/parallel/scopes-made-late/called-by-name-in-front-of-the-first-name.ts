function outer(early: boolean): string { try { if (early) return "got " + read(); const held = "value"; return "fine " + read(); function read(): string { return held; } } catch (e: any) { return e.constructor.name; } }
console.log(outer(true), outer(false));
