// Flags: --react-compiler
// Reference: bun build --compile
// The strings that a tag gets are those of the source, one frozen object for each place.
const told = (strings, ...values) => [strings.join("|"), strings.raw.join("|"), Object.isFrozen(strings), Object.isFrozen(strings.raw), values.length].join(" ");
const same = strings => strings;
const held = { prefix: "<", tag(strings) { return this.prefix + strings.raw[0]; } };
function useTold() { "use memo"; return told`größe 日本`; }
function useSame() { "use memo"; return same`ü`; }
function useLate() { "use memo"; return () => same`naïve`; }
function useTags(tag) { "use memo"; return [held.tag`ß`, tag`é`, told`plain`, (() => tag`später`)()]; }
console.log(useTold());
console.log(useSame() === useSame(), useSame().raw[0], useLate()() === useLate()());
console.log(useTags(told).join(" ; "));
