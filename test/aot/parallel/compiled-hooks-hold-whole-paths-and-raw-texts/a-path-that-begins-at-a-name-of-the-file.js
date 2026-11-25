// Flags: --react-compiler --define=WIDTH=theme.width
// Reference: bun build --compile
const theme = { width: 1 };
function useOfFile() { "use memo"; return [WIDTH]; }
function useOfParameter(theme) { "use memo"; return [WIDTH]; }
console.log(useOfFile().join(), useOfParameter({ width: 2 }).join(), useOfParameter({ width: 3 }).join());
