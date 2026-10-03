const f = () => {};
const g = () => {};
process.on("SIGINT", f);
process.on("SIGINT", g);
process.off("SIGINT", f);
process.off("SIGINT", g);
process.on("SIGINT", f);
process.off("SIGINT", f);
setTimeout(() => {}, 1);
