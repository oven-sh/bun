function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => typeof setTimeout("globalThis.ran = 1", 0));
setTimeout(() => console.log(String(globalThis.ran)), 5);
