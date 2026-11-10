function show(...all) { console.log(all[0]); }
const list = JSON.parse("[]");
list[0] = new URL("http://made.up/a?b=" + (process.argv[2] || "seven"));
show("first");
list.forEach(show);
