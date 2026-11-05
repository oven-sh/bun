function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => (function () {})[["const", "ructor"].join("")]("return 1 + 1")());
