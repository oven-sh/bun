export function answer() { return ["never", "loaded", "by-text"].map(text => text.toUpperCase() + process.argv.length).join("-"); }
console.log("unused-by-text runs", answer());
