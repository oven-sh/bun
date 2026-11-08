// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.mjs
// The entry point binds members of the process object.
import { stdout, stderr, argv, env, cwd, nextTick } from "node:process";
nextTick(() => stdout.write("tick\n"));
stdout.write([stdout === process.stdout, stderr === process.stderr, argv === process.argv, env === process.env, typeof cwd()].join() + "\n");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
