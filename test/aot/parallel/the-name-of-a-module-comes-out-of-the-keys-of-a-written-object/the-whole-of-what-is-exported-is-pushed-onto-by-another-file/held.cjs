const names = (module.exports = ["one", "two"]);
process.nextTick(() => { for (const name of names) console.log("SAID", name, require(`./${name}.cjs`).name); });
