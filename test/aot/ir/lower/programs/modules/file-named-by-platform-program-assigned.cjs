// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.cjs
// The program assigns a name of its own to process.platform, takes it out of process by a pattern and names a file by it.
// In such a name the build takes the platform for the one that the executable is built for, so the executable holds that file and not the other, and require() says that it did not find it.
process.platform = "made-up";
const { platform } = process;
console.log(platform);
try {
  console.log(require(`./part.${platform}.cjs`).name);
} catch (error) {
  console.log(error.code);
}

// FILE: part.darwin.cjs
exports.name = "darwin";

// FILE: part.linux.cjs
exports.name = "linux";

// FILE: part.made-up.cjs
exports.name = "made-up";

// FILE: part.win32.cjs
exports.name = "win32";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
