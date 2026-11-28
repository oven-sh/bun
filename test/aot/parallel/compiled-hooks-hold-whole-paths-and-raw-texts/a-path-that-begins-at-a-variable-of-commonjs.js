// Flags: --react-compiler --define=RESOLVE=require.resolve --define=ID=module.id --define=OWN=exports.own
// Reference: bun build --compile
const kind = read => { try { return read(); } catch (e) { return e.name; } };
function useResolve() { "use memo"; return [typeof RESOLVE]; }
function useId() { "use memo"; return [typeof ID]; }
function useOwn() { "use memo"; return [typeof OWN]; }
console.log(kind(useResolve), kind(useId), kind(useOwn), kind(() => typeof ID));
