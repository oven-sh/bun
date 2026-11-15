/** @import { sheet } (partial.css) */
try {
  sheet();
} catch (error) {
  console.log(error.name);
}
