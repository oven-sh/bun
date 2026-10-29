// A --define value may be a BigInt, and a path whose members are reserved words.
// Flags: --define=BIG=123n --define=WORD=holder.if --define=DEEP=holder.class.new
// Reference: bun build --compile
globalThis.holder = { if: "a member named if", class: { new: () => "called" } };
console.log(BIG + 1n, typeof BIG, BIG === 123n, WORD, DEEP(), typeof DEEP);
