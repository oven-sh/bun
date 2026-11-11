let early = "early";
exports.read = () => early + late;
if (process.argv.length < 99) throw new Error("half way");
let late = "late";
