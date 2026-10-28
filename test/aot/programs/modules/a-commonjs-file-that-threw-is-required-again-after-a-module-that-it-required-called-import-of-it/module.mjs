import("./file.cjs").then(
  namespace => console.log("module: imported", namespace.value),
  error => console.log("module: rejected", error.message),
);
