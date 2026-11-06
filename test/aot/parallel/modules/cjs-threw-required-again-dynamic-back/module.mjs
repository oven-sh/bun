import("./file.cjs").then(namespace => console.log("module: imported", Object.keys(namespace).join()));
