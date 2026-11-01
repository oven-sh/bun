// Flags: --aot-verify-each-pass
// The `try` stands inside the loop: each turn catches its own error. The look-up does not go in front of the loop, where no `catch` covers it.
const key = ["a"].join("");
function has(map, key, turns) { let found = 0, caught = 0; for (let i = 0; i < turns; i++) { try { if (map.has(key)) found++; } catch (error) { caught++; } } return found + " found, " + caught + " caught"; }
function get(map, key, turns) { let sum = 0, left = 0; for (let i = 0; i < turns; i++) { try { sum += map.get(key) ?? 0; } finally { left++; } } return sum + " in all, " + left + " left"; }
console.log(has(new Map([["a", 1]]), key, 3), "|", has(new Map(), key, 3), "|", has(new Map([["a", 1]]), key, 0));
console.log(get(new Map([["a", 2]]), key, 3), "|", get(new Map(), key, 3), "|", get(new Map([["a", 2]]), key, 0));
