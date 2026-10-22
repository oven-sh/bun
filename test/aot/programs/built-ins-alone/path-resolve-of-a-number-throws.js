import path from "node:path";
try {
  path.resolve(1.5);
} catch (error) {
  console.log(error instanceof TypeError, error.code);
}
