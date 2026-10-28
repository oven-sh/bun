import("./file.cjs").then(
  namespace => console.log("module: imported", Object.keys(namespace).join()),
  error => console.log("module: rejected", error.message),
);
setTimeout(() => {
  try {
    console.log("timer: required", Object.keys(require("./file.cjs")).join());
  } catch (error) {
    console.log("timer: require threw", error.message);
  }
  import("./file.cjs").then(
    namespace => console.log("timer: imported", Object.keys(namespace).join()),
    error => console.log("timer: rejected", error.message),
  );
}, 5);
