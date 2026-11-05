function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => globalThis[["Func", "tion"].join("")]("return 1 + 1")());
