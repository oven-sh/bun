// `path in cache` and `cache[path] = answer` with keys of over 2,048 characters, in an object that comes to hold thousands of them, as the `ignore` package keeps its answers.
// A long key is compared with an object's names only while that costs less than its hash.
const box = JSON.parse("[0]");
function hidden(value) {
  box[0] = value;
  return box[0];
}
const piece = hidden("0xxxxxx/");
function pathOf(depth, tail) {
  let path = "";
  for (let i = 0; i < depth; i++) path += piece;
  return path + tail;
}
const cache = Object.create(null);
let hits = 0,
  misses = 0,
  sum = 0;
for (let round = 0; round < 3; round++) {
  for (let depth = 250; depth < 520; depth += 3) {
    for (let file = 0; file < 8; file++) {
      const path = pathOf(depth, "f" + file);
      if (path in cache) {
        hits++;
        sum += cache[path];
      } else {
        misses++;
        cache[path] = depth * 8 + file;
      }
    }
  }
}
console.log(hits, misses, sum, Object.keys(cache).length);
const flat = pathOf(400, "f1").split("").join("");
console.log(
  flat in cache,
  cache[flat],
  Object.hasOwn(cache, flat),
  pathOf(400, "f9") in cache,
  cache[pathOf(400, "f9")],
);
delete cache[pathOf(400, "f1")];
console.log(flat in cache, cache[flat], Object.keys(cache).length);
const heir = Object.create(cache);
console.log(
  pathOf(403, "f2") in heir,
  Object.hasOwn(heir, pathOf(403, "f2")),
  heir[pathOf(403, "f2")],
);
heir[pathOf(403, "f2")] = "own";
console.log(
  Object.hasOwn(heir, pathOf(403, "f2")),
  heir[pathOf(403, "f2")],
  cache[pathOf(403, "f2")],
);
