import defer * as n from "./owner.ts";
try { const c = n.X.C; console.log("X.C " + c); } catch (e) { console.log("caught " + (e as Error).message); }
