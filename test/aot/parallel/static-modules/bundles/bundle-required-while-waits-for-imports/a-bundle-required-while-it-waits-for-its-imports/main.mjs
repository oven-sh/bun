// A bundle is required by a call while it waits for what it imports.
import "./other.cjs";
import { run } from "./bundle.mjs";
console.log("main", run(1));
