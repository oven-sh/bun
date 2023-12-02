import { importBun, optimizeBun } from "../src/npm/install";

importBun()
  .then(path => {
    optimizeBun(path);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
