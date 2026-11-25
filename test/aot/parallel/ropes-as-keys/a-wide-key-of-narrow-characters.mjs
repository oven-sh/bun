const input = JSON.parse('{"a":"alpha","b":"beta","x":"x","y":"y","narrowInWide":"xy\\u03b1"}');
const { a, b, x, y, narrowInWide } = input;
const said = [];
for (let turn = 0; turn < 300; turn++) {
  said.length = 0;
  const map = new Map();
  const wideKey = narrowInWide.substring(0, 2) + a;
  map.set(wideKey, turn);
  const key = x + y + a;
  const around = b + key + b;
  const twice = key + key;
  said.push(map.get(key), map.has(key), key.length, key.charCodeAt(1), key === "xyalpha", key === wideKey);
  said.push(around, around.length, twice, twice.toUpperCase(), JSON.stringify(around), Buffer.from(twice).length, new TextEncoder().encode(around).length, around.indexOf("alpha"), [...twice].length);
  const set = new Set([wideKey]); const other = y + x + a; const outer = other + "|" + key;
  said.push(set.has(x + y + a), set.has(other), outer, outer.split("|").length);
}
console.log(said.join("\n"));
