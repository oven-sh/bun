process.on("custom", () => { console.log("first"); throw new Error("x"); });
process.on("custom", () => console.log("second"));
try { process.emit("custom"); } catch { console.log("caught"); }
