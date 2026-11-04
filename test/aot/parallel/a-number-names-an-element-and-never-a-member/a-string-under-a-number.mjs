function get(h, i) { return h[i]; }
console.log(get("ab", [].length), get("ab", 5), get("ab", -1), get("ab", 0.5), typeof get("ab", 0 / [].length));
