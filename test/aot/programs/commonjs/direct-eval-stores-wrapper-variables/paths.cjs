console.log("paths at the start:", typeof __filename, typeof __dirname, __filename.startsWith(__dirname));
eval("__filename = 'file'; __dirname = 'directory'");
console.log("paths after eval:", __filename, __dirname);
var read = () => [__filename, __dirname].join();
eval("__dirname += '!'");
console.log("paths read by an arrow:", read());
