// Flags: --aot-verify-each-pass
// A look-up in a Map or a Set with the same key in every turn is made once, in front of the loop. To hash a string that was joined it is made flat, and memory may run out: the error belongs to the `catch` around the loop.
const key = ["a"].join("");
function has(map, key, turns) { let found = 0; try { for (let i = 0; i < turns; i++) { if (map.has(key)) found++; } } catch (error) { return "caught " + error.name; } return "found " + found; }
function get(map, key, turns) { let sum = 0; try { for (let i = 0; i < turns; i++) { sum += map.get(key) ?? 0; } } catch (error) { return "caught " + error.name; } return "sum " + sum; }
function inSet(set, key, turns) { let found = 0; try { for (let i = 0; i < turns; i++) { if (set.has(key)) found++; } } catch (error) { return "caught " + error.name; } finally { found = -1; } return "found " + found; }
console.log(has(new Map([["a", 1]]), key, 3), has(new Map(), key, 3), has(new Map([["a", 1]]), key, 0));
console.log(get(new Map([["a", 2]]), key, 3), get(new Map(), key, 3), get(new Map([["a", 2]]), key, 0));
console.log(inSet(new Set(["a"]), key, 3), inSet(new Set(), key, 3), inSet(new Set(["a"]), key, 0));
