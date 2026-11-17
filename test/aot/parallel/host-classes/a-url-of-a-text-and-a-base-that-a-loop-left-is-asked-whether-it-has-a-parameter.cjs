// The text and the base are both what a loop left; the question is `has`, in a handler.
const data = JSON.parse('{"from":0,"pairs":[["/c?d=f%20g","https://a.example/z"],["?d","https://a.example/k?e=1"],["https://b.example/?%64=1","https://a.example/"]]}');
function read(first, second, base, other, from, turns, call) {
  for (let i = from; i < turns; i++) { const kept = first; first = second; second = kept; const held = base; base = other; other = held; }
  const url = new URL(first, base);
  try {
    call();
    return url.pathname;
  } catch {
    return url.searchParams.has("d") + ":" + url.searchParams.get("d");
  }
}
globalThis.handed = [read];
const fails = () => { throw 1; };
for (let turns = 0; turns < 3; turns++) for (let at = 0; at < 3; at++) { const one = data.pairs[at], two = data.pairs[(at + 1) % 3]; console.log(read(one[0], two[0], one[1], two[1], data.from, turns, fails)); }
