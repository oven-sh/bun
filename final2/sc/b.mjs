const f = () => {};
process.on("SIGINT", f);
process.off("SIGINT", f);
setTimeout(() => {}, 1);
