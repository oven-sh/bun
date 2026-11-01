// `require.main === module` is answered by whether the file is the entry point, as long as the two names hold what the file was handed.
require = { main: undefined };
console.log(require.main === module);
