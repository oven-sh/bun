// answers: with-library
// # A Buffer that the program makes is followed by the place that makes it. A method called on it is the built-in of that name as long as the flow has seen nothing laid on the Buffer or above it:
// # so the call hands neither the Buffer nor its arguments to code that nobody has seen, though no mark at run time says that a Buffer is as its class makes it.
// # The second Buffer gets a method of the program's own under the name: it is no longer as made.
// # RUN(LINK): link variables mechanisms=all
// # REQUIRES(LINK): entries-of-bun
// # LINK: variable g0 {{*}}Buffer {{*}}stays-as-made
// # LINK-NOT: variable g1 {{*}}stays-as-made
const kept = Buffer.alloc(16, 3);
const changed = Buffer.alloc(16, 3);
function own(at) { return "own" + at; }
function sumOfKept() { let s = 0; for (let i = 0; i < 16; i++) s = s + kept.readUInt8(i); return s; }
function sumOfChanged() { let s = 0; for (let i = 0; i < 3; i++) s = s + changed.readUInt8(i); return s; }
report(sumOfKept());
report(kept.writeUInt16LE(7, 2));
changed.readUInt8 = own;
report(sumOfChanged());
report("end");
