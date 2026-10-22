import path from "node:path";
try {
  path.basename(1.5);
} catch (error) {
  console.log(error instanceof TypeError, error.code);
}
