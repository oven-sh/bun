import { execFileSync } from "child_process";
import { importBun } from "../src/npm/install";

importBun()
  .then(bun => {
    return execFileSync(bun, process.argv.slice(2), {
      stdio: "inherit",
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
