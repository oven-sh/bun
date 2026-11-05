function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => Object.getOwnPropertyNames(globalThis).map(name => globalThis[name]).find(v => typeof v === "function" && v.name === "Function")("return 1 + 1")());
