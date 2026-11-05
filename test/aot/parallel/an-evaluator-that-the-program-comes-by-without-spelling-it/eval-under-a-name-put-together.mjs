function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => globalThis[["ev", "al"].join("")]("1 + 1"));
