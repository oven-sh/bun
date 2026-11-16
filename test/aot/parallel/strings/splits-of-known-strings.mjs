// The pieces of one known string: each loop has its own array, whatever was done to the one before.
const text = "some words that are wrapped at a width";
function pieces() {
  let joined = "";
  for (const word of text.split(" ")) joined = joined ? joined + "+" + word : word;
  return joined;
}
function changed() {
  const words = text.split(" ");
  words[0] = "changed";
  words.push("more");
  words.reverse();
  return words.join();
}
function nested(t) {
  let n = 0;
  for (const word of t.split(" ")) for (const part of word.split("a")) n += part.length + 1;
  return n;
}
function leaves() {
  for (const word of text.split(" ")) if (word.length > 5) return word;
}
function catches() {
  let seen = "";
  try {
    for (const word of text.split("a")) {
      seen += word;
      if (seen.length > 20) throw new Error(seen);
    }
  } catch (error) {
    return error.message;
  }
}
const all = [];
for (let k = 0; k < 200; k++) all.push([pieces(), changed(), nested(text), leaves(), catches()].join("/"));
console.log(all[0], all.every(a => a === all[0]));
const kept = [];
for (let k = 0; k < 5; k++) for (const word of "a,b,,c".split(",")) kept.push(word + k);
console.log(kept.join());
for (const word of "".split(" ")) console.log("[" + word + "]");
