// Flags: --compile-exec-argv=--sql-preconnect
// The start of the executable reads Bun.sql and calls its connect() by itself, whatever the program says.
console.log("ran");
