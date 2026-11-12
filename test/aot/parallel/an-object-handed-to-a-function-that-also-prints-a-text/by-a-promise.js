function show(x) { console.log(x); }
const held = JSON.parse("{}");
held.wait = Promise.resolve(new URL("http://made.up/a?b=" + (process.argv[2] || "seven")));
show("first");
held.wait.then(show);
