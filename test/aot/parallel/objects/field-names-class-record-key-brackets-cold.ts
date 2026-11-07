// Two files make holders with the same two keys. The part of one kind has an arrow function in a field. A plain record comes into such a holder, and the loop calls the function that the record has.
// Flags: --aot-heat=everything-is-cold
// Erased types: not built: field-names-class-record-key-brackets is built so
import "./field-names-class-record-key-brackets/parts-that-are-read.ts";
import "./field-names-class-record-key-brackets/parts-that-are-named.ts";
