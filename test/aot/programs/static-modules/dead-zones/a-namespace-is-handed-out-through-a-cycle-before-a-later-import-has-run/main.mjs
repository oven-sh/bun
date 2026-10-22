// As its neighbor, through the namespace object, which d.mjs also keeps for later.
import "./a.mjs";
console.log("main", globalThis.kept.f(), globalThis.kept.own);
