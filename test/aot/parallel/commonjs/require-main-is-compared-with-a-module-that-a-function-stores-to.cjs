// `require.main === module` is answered by whether the file is the entry point, as long as the two names hold what the file was handed.
function change() {
  module = 1;
}
console.log(require.main === module);
change();
console.log(require.main === module, typeof require.main);
