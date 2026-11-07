// Two files make holders with the same two keys. The part of one kind has an arrow function in a field. Something else comes into such a holder through `any`, and the loop calls what that has under the name, or throws as plain Bun does.
// Flags: --aot-heat=everything-is-cold
// Erased types: not built: field-that-names-class-holds-function is built so
import "./field-that-names-class-holds-function/parts-that-are-read.ts";
import "./field-that-names-class-holds-function/parts-that-are-named.ts";
