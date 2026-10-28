import Default, { AbortController as Controller, AbortSignal as Signal } from "abort-controller";
import * as namespace from "abort-controller";
console.log(Default === AbortController, Controller === AbortController, Signal === AbortSignal);
console.log(Object.keys(namespace).sort().join());
console.log(Object.getOwnPropertyNames(AbortController).sort().join());
console.log(new Default().signal.aborted);
