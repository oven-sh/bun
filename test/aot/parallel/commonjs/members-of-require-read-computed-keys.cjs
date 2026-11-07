// `cache`, `extensions` and `main` are enumerable members above `require`, so a walk lists them, and a read under a key that is computed finds what a read by name finds.
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
const walked = [];
for (const key in require) walked.push(key + " " + typeof require[key]);
console.log(walked.join());

const pick = (first, second) => (process.argv.length > 99 ? first : second);
console.log(typeof require[pick("resolve", "cache")], typeof require[pick("resolve", "extensions")], typeof require[pick("resolve", "main")]);
console.log(require[pick("resolve", "main")] === module, require[pick("resolve", "cache")] === require.cache);

const listed = [];
for (const key of ["resolve", "cache", "extensions", "main"]) listed.push(typeof require[key]);
console.log(listed.join());
