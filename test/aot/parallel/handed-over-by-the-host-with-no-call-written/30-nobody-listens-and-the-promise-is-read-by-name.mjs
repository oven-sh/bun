async function load() { return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
const kept = load();
await 0;
kept.then(loaded => console.log(nameOf(loaded)));
console.log(nameOf(await kept));
