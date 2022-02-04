import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $4068f25b from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/index.js";
var InexactRoot = require($4068f25b);
import * as $d2a171d2 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/dir/file.js";
var InexactFile = require($d2a171d2);
import * as $522c6d1f from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/foo.js";
var ExactFile = require($522c6d1f);
import * as $fce83cd7 from "http://localhost:8080/package-json-exports/node_modules/js-only-exports/browser/js-file.js";
var JSFileExtensionOnly = require($fce83cd7);
export async function test() {
  console.assert(InexactRoot.target === "browser");

  console.assert(InexactFile.target === "browser");
  console.assert(ExactFile.target === "browser");
  console.assert(JSFileExtensionOnly.isJS === true);
  return testDone(import.meta.url);
}

