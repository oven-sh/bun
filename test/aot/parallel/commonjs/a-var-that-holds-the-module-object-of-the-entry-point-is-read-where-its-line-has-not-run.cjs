// A `var` is undefined until its line has run: nothing is read off it there, though the file that starts the program has the id "." and is loaded.
if (process.argv.length > 40) { var mo = module; }
console.log(typeof mo?.exports, typeof mo?.id, typeof mo?.filename, typeof mo?.path, typeof mo?.loaded);
try { console.log(mo.id); } catch (error) { console.log(error.name); }
try { console.log(mo.exports); } catch (error) { console.log(error.name); }
