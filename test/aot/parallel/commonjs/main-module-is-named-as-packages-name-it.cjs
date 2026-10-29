// What packages write to learn whether their file was started or required: `require.main`, beside the other members of `require` and `module`.
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
"use strict";
function resolves() {
  return (
    typeof require.resolve + typeof require.cache + typeof require.main + typeof module.id + typeof module.filename
  );
}
function isStarted() {
  return require.main === module;
}
function nameOfStarted() {
  return require.main.filename === module.filename && require.main.id === module.id;
}
if (require.main === module) console.log("started");
console.log(resolves(), isStarted(), nameOfStarted(), module.id, require.main.children.length, require.main.loaded);
