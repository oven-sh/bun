// Flags: --react-compiler --define=WIDTH=theme.size.width --define=theme=other --define=MODE=process.env.NODE_ENV
// Reference: bun build --compile
// A name is replaced once: nothing in what stands in its place is.
globalThis.theme = { size: { width: 40 } };
globalThis.other = { size: { width: 7 } };
process.env.NODE_ENV = "at run time";
function useWidth() { "use memo"; return [WIDTH, theme.size.width, MODE]; }
console.log(useWidth().join());
