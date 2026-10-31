// `require.main.filename`, `.path` and `.loaded` are answered by the record of the entry file as long as nobody holds its module object. Here somebody does, so they are read off
// what `require.main` answers, and that was undefined: nothing else in the program named a way to a module object.
console.log(typeof require.main.filename, [module].length);
