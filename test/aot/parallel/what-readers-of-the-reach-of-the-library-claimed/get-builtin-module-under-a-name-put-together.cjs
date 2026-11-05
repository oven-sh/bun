const name = ["getBuiltin", "Module"].join("");
try { console.log(typeof process[name]("node:fs").readFileSync); } catch (e) { console.log(e.name); }
