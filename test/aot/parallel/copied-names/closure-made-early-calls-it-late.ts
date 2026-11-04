function outer(): string { const later = () => read(); const held = "late"; return later(); function read(): string { return held; } }
function thrower(): string { const sooner = () => read(); try { return sooner(); } catch (e: any) { return e.constructor.name; } finally { } const held = "never"; function read(): string { return held; } }
console.log(outer(), thrower());
