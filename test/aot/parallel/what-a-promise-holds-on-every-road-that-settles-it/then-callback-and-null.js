function thrower() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; throw "late" + work; }
function handle(e) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "caught " + typeof e + ":" + (typeof e === "object" && e !== null ? (e.tag ?? e.name + "/" + e.message) : e) + ":" + work; }
function show(text) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; console.log(text); }
Bun.sleep(0).then(thrower, null).catch(handle).then(show);
export {};
