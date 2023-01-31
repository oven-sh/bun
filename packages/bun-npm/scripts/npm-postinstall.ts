import { importBun, optimizeBun } from "../src/install";

importBun()
  .then((path) => {
    optimizeBun(path);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
