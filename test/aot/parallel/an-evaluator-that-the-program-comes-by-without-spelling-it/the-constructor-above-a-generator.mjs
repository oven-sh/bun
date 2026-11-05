function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => Object.getPrototypeOf(function* () {}).constructor("yield 2")().next().value);
