import os from "node:os";
import { lookup } from "node:dns";
import * as url from "node:url";
function neverCalled() {
  return [typeof url.parse, typeof lookup, os.constants];
}
postMessage("the worker read no name: " + typeof neverCalled);
