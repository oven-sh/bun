export function answer() { return ["never", "loaded", "by-import"].map(text => text.toUpperCase() + process.argv.length).join("-"); }
console.log("unused-by-import runs", answer());
