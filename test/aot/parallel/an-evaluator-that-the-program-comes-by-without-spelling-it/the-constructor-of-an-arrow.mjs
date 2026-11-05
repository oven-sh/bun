function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => (() => 0).constructor("return 1 + 1")());
