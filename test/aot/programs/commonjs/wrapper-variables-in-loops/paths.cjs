console.log("paths at the start:", typeof __filename, typeof __dirname, __filename.startsWith(__dirname));
var i = 0;
do { __filename = "file " + i; __dirname = "directory " + i; i++; } while (i < 2);
console.log("paths after do:", __filename, __dirname);
