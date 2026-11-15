const { Made } = await import("./parts.mjs"); console.log("SAID", [...new Made("*.none").scanSync(".")].length);
