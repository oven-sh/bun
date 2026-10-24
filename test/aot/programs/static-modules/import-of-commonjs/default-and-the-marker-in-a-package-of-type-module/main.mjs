// The same file in a package whose package.json says "type": "module": the marker is ignored, and the default import is the exports object.
import d, * as ns from "./a.cjs";
console.log(typeof d, Object.keys(ns).join(), ns.__esModule);
