// A query text of which names are asked, the pairs are walked and the text is written again.
// STATISTIC: URLsLeftUnbuilt >= 3
const texts = ["", "?", "a", "a=", "a=1", "?a=1", "??a=1", "=1", "=", "a=1&b=2", "a=1&a=2", "b=2&a=1", "a=1&", "&a=1", "a=1&&b=2", "a=1=2", "a==", "a+=1", "a=1+2", "a=%31", "%61=1", "b=%zz&a=1", "b=2&a%20=1&a=3", "b=2&c&a=3", "b=2&a=3&c", "a=*-._", "a=~", "a=!", "a=/", "a=é", "a=一", "a=1#f", "A=1", "aa=1", "a=1&b=2&c=3&d=4&e=5", "a=" + "x".repeat(4090), "a=" + "x".repeat(4093), "a=" + "x".repeat(4094), "a=" + "x".repeat(5000)];
function look(text) {
  const query = new URLSearchParams(text);
  return query.get("a") + " | " + query.has("a") + " | " + query.get("c") + " | " + query.has("") + " | " + query.size + " | " + query.toString().slice(0, 60);
}
function walk(text) {
  const query = new URLSearchParams(text);
  let out = "";
  for (const [name, value] of query) out += name + ":" + value.slice(0, 20) + ";";
  return out;
}
function names(text) { const query = new URLSearchParams(text); let out = ""; for (const name of query.keys()) out += name + ";"; return out; }
function values(text) { const query = new URLSearchParams(text); let out = ""; for (const value of query.values()) out += value.slice(0, 20) + ";"; return out; }
function pairs(text) { const query = new URLSearchParams(text); return JSON.stringify([...query.entries()]).slice(0, 80); }
for (const text of texts) console.log(JSON.stringify(text.slice(0, 40)), text.length, JSON.stringify(look(text)), JSON.stringify(walk(text)), names(text), values(text), pairs(text));
for (const other of [1, null, undefined, { a: 1 }, [["a", "1"]], new URLSearchParams("a=7")]) console.log(JSON.stringify(look(other)), walk(other));
