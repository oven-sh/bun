function make() { const made = async function () {}.constructor = 2; }
function run() { const o = make(); console.log("before")(() => { try { o.constructor; } catch (e) {} }); }
try { run(); } catch (e) { console.log("run threw", e.name, e.message); }
