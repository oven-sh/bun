export function answer() { return ["never", "loaded", "by-member"].map(text => text.toUpperCase() + process.argv.length).join("-"); }
console.log("unused-by-member runs", answer());
