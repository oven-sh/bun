// a written text is compared with, and looked up against, texts of the same characters that were joined, cut and parsed while the program ran; and against what only looks the same
const parts = JSON.parse('["con", "fig", "xconfigx", "Config", "config "]');
function made() { return [parts[0] + parts[1], parts[2].slice(1, 7), `${parts[0]}${parts[1]}`, String(Object("config")), parts[3], parts[4], Object("config"), undefined]; }
function same(x) { return (x === "config") + ":" + (x == "config") + ":" + ("config" === x) + ":" + Object.is(x, "config"); }
function inMap(x) { const cache = new Map([[x, 1]]); return cache.get("config") + ":" + cache.has("config"); }
function inSet(x) { return new Set([x]).has("config"); }
function inObject(x) { const o = { [x]: 1 }; return Reflect.has(o, "config") + ":" + Object.hasOwn(o, "config") + ":" + o["config"]; }
function inList(x) { return [x].indexOf("config") + ":" + [x].includes("config"); }
function chosen(x) { switch (x) { case "config": return "chosen"; case "Config": return "capital"; default: return "neither"; } }
for (let turn = 0; turn < 3; turn++) {
  const texts = made();
  for (let i = 0; i < texts.length; i++)
    console.log(i, same(texts[i]), inMap(texts[i]), inSet(texts[i]), inObject(texts[i]), inList(texts[i]), chosen(texts[i]));
}
