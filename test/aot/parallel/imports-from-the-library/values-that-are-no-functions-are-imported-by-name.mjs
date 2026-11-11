import events, { defaultMaxListeners, errorMonitor, captureRejectionSymbol } from "node:events";
import { sep, delimiter, posix, win32 } from "node:path";
import { constants, promises } from "node:fs";
import { EOL } from "node:os";
import { types, TextDecoder as Decoder } from "node:util";
console.log(defaultMaxListeners, typeof errorMonitor, String(captureRejectionSymbol), sep, delimiter, posix.sep, win32.sep, typeof constants.O_RDONLY, typeof promises.readFile, JSON.stringify(EOL), types.isPromise(Promise.resolve()), new Decoder().encoding);
events.defaultMaxListeners = 33;
console.log(defaultMaxListeners, events.defaultMaxListeners, new events().getMaxListeners());
