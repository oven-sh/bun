function value(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "value " + typeof v + ":" + (typeof v === "number" ? v : "not a number") + ":" + work; }
function show(text) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; console.log(text); }
function giver() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { held: work, then(resolve) { resolve(21); } }; }
async function fails() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; throw "first" + work; }
fails().catch(giver).then(value).then(show);
export {};
