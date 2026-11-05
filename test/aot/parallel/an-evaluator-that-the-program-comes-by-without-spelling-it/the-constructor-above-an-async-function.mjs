function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => typeof Object.getPrototypeOf(async function () {}).constructor("return 1")());
