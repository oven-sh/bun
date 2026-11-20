export function answer() { return ["never", "loaded", "by-pattern"].map(text => text.toUpperCase() + process.argv.length).join("-"); }
console.log("unused-by-pattern runs", answer());
