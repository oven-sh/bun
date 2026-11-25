let found;
try {
  found = Object.keys(import.meta.glob("./parts/*.js")).join(",");
} catch (error) {
  found = error.name + ": " + error.message;
}
export { found };
