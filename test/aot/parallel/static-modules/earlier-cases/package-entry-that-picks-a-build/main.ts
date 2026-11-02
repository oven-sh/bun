// `module.exports = require(..)` in each arm of a test of process.env.NODE_ENV, which the build folds.
// Flags: --define process.env.NODE_ENV="production"
// Env: NODE_ENV=production
declare const console: { log(...values: unknown[]): void };
import { useState, version } from "./index.js";
import * as React from "./index.js";
import Default from "./index.js";
import { version as twice } from "./plainly.js";
import { viaRequire } from "./user.cjs";
console.log(useState(1).join(), version, React.useState(2).join(), React.version, Default.useState(3).join(), twice, viaRequire());
