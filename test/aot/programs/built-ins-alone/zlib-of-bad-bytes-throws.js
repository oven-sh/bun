import zlib from "node:zlib";
try {
  zlib.gunzipSync("not gzip");
} catch (error) {
  console.log(error instanceof Error, error.code, typeof error.errno);
}
