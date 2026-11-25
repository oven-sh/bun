// Flags: --react-compiler --define=FIRST=second --define=second=third --define=SAY=tools.say --define=tools.say=tools.other --define=KEEP=kept.call --drop=kept
// Reference: bun build --compile
// A name is replaced once, also where one name stands for another, and what a define wrote is not dropped.
Object.assign(globalThis, { second: 2, third: 3, tools: { say: () => "say", other: () => "other" }, kept: { call: () => "kept" } });
function useNames() { "use memo"; return [FIRST, second, SAY(), tools.say(), KEEP(), kept.call()]; }
function useStore() { "use memo"; return value => { FIRST = value; }; }
console.log(useNames().join());
useStore()(4);
console.log(globalThis.second, globalThis.third);
