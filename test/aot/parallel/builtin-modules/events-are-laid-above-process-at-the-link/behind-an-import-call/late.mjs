import zlib from "node:zlib";
export const read = () => typeof zlib.gzipSync;
