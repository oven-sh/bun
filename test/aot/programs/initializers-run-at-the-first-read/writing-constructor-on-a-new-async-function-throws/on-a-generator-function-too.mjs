function make() { const made = function* () {}.constructor = 2; }
function run() { const o = make(); console.log("before"); const f = () => { try { o.constructor; } catch (e) {} }; f(); }
try { run(); } catch (e) { console.log("run threw", e.name, e.message); }
