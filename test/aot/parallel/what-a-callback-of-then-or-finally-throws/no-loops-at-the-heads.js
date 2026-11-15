function thrower() { throw "late"; }
function handle(e) { return typeof e + ":" + e; }
function show(text) { console.log(text); }
Bun.sleep(0).finally(thrower).catch(handle).then(show);
export {};
