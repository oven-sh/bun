// A string literal type holds a byte that is not UTF-8. The file that declares the type is not checked and has a tsconfig.json of its own,
// so the build reads it for its types alone. It must read the byte as it does in the compiled file that uses the type.
import "./inner/start.ts";
export {};
