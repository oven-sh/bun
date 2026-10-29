import("./file.cjs").then(
  namespace => console.log("second: imported", Object.keys(namespace).join()),
  error => console.log("second: rejected", error.message),
);
