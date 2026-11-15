// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// STATISTIC: SourceFilesData = 1

// FILE: main.cjs
﻿console.log("behind a byte order mark", require("./d.json").k, require("./m.cjs").v);

// FILE: d.json
﻿{"k":1}

// FILE: m.cjs
﻿#!/usr/bin/env bun
exports.v = "crlf";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
