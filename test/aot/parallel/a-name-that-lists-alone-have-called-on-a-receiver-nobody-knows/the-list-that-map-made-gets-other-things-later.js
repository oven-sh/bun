"use strict";
const D = JSON.parse("[[1],[2],[3]]");
const V = D.map(r => Float64Array.from(r));
function first(V) { let s = ""; for (let i = 0; i < V.length; i++) s += V[i][0]; return s; }
let a = ""; for (let t = 0; t < 30; t++) a = first(V);
V.push("xy", [true], { 0: null });
V[0] = undefined;
let b; try { for (let t = 0; t < 30; t++) b = first(V); } catch (error) { b = error.constructor.name; }
console.log(a, b);
