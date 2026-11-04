function outer(): string { let n = 0; const early = () => { n++; return held + n; }; let said: string; try { said = early(); } catch (e: any) { said = e.constructor.name; } const held = "h"; return said + " " + early(); }
console.log(outer());
