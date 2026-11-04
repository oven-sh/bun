// a side throws
function boom(): never { throw new Error("thrown"); }
function ask(a: any): boolean { return !(a && boom()); }
for (const a of [0, 1, "", "x", null]) { try { console.log(String(a), ask(a)); } catch (error) { console.log(String(a), (error as Error).message); } }
