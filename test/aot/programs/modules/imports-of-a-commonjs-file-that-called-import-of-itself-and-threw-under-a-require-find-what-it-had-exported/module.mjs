try {
  require("./file.cjs");
} catch (error) {
  console.log("module: require threw", error.message);
}
import("./file.cjs").then(
  namespace => console.log("module: imported", Object.keys(namespace).join()),
  error => console.log("module: rejected", error.message),
);
