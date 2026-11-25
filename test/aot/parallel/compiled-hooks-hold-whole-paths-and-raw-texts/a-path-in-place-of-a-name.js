// Flags: --react-compiler --define=WIDTH=theme.size.width --define=GROW=theme.size.grow --define=LOG=theme.log --define=process.env.WIDTH_OF_BUILD=theme.size.width
// Reference: bun build --compile
// The path stands where the name stood: with its receiver, as an operand of typeof and as a target.
globalThis.theme = { size: { width: 40, grow(by) { return this.width + by; } }, log: [] };
function useWidth() { "use memo"; return [WIDTH, typeof WIDTH, typeof GROW, GROW(2), WIDTH / 2, process.env.WIDTH_OF_BUILD]; }
function useStores() { "use memo"; return value => { WIDTH = value; return LOG.push(WIDTH); }; }
console.log(useWidth().join());
console.log(useStores()(41), theme.size.width, theme.log.join());
console.log(useWidth().join());
