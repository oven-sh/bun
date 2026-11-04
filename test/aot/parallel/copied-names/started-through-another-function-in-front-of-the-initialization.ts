function outer(early: boolean): string { try { if (early) first(); const held = 7; return "fine " + first(); function first(): number { return second(); } function second(): number { return held; } } catch (e: any) { return e.constructor.name; } }
console.log(outer(true), outer(false));
