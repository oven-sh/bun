// transcode of node:buffer answers a Buffer that native code makes, and Buffer.prototype.toJSON is written in JavaScript.
import { transcode } from "node:buffer";
console.log(transcode(new Uint8Array([97]), "utf8", "ucs2").toJSON());
