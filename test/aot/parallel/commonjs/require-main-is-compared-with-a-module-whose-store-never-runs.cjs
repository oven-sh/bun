// `require.main === module` is answered by whether the file is the entry point, as long as the two names hold what the file was handed.
if (process.argv.length > 99) module = 1;
console.log(require.main === module);
