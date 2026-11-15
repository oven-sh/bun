import("./named.mjs").then(it => console.log("SAID", it.look()), error => console.log("SAID", error.name));
