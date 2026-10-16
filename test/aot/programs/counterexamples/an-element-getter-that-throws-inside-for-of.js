// An exception out of an element read in `for..of` is caught by the `try` around the loop.
function f(a) { try { for (const x of a) Object.defineProperty(a, 1, { get() { throw "boom"; } }); } catch (e) { return "caught " + e; } }
try { console.log(f([1, 2])); } catch (e) { console.log("the caller caught " + e); }
