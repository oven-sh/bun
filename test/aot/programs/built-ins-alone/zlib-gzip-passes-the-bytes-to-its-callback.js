import zlib from "node:zlib";
zlib.gzip("hello", function (error, bytes) {
  console.log(error === null, bytes instanceof Buffer, arguments.length);
  zlib.gunzip(bytes, (failure, text) => console.log(failure === null, text.toString()));
});
