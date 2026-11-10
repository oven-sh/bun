try { await import("./holder.mjs"); } catch (error) { console.log("import threw", error.message); }
await new Promise(resolve => setTimeout(resolve, 20));
console.log("end");
