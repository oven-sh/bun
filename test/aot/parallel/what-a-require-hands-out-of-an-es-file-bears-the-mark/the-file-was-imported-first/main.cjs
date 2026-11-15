const interop = loaded => (loaded && loaded.__esModule ? loaded.default : loaded);
import("./teapot.mjs").then(imported => {
  console.log("imported", imported.__esModule, typeof imported.default, interop(imported) === imported);
  const teapot = require("./teapot.mjs");
  console.log("required", teapot.__esModule, typeof teapot.default, interop(teapot).holds, teapot === imported, imported.__esModule);
});
