// `platform=` says whose code of Bun's own modules a program gets. On Windows `process.env` is a proxy that folds the case of
// names, and what it is made of is lowered for that platform alone.
// OPTIONS: builtin-modules
// RUN(LINUX): link
// OPTIONS(LINUX): platform=linux
// LINUX: function {{*}}name="spawnSync"
// LINUX-NOT: function {{*}}name="writeEnvVar"
// RUN(DARWIN): link
// OPTIONS(DARWIN): platform=darwin
// DARWIN-NOT: function {{*}}name="writeEnvVar"
// RUN(WINDOWS): link
// OPTIONS(WINDOWS): platform=windows
// WINDOWS: function {{*}}name="writeEnvVar"

import { spawnSync } from "node:child_process";
export const start = spawnSync;
