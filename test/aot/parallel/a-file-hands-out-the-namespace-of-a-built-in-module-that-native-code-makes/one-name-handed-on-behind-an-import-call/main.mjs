const { Glob } = await import("./parts.mjs");
console.log("SAID", [...new Glob("*.none").scanSync(".")].length);
