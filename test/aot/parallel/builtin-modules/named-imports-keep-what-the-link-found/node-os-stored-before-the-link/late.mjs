import os, { platform, devNull, madeUp, type } from "node:os";
console.log(platform(), devNull, madeUp, typeof type, os.platform(), os.devNull, os.madeUp, typeof os.homedir);
