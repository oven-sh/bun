// The key is cut off a longer text in every turn, looked up, deleted and stored under again (a touch), or stored under for the first time together with an object that keeps it.
const lines = Array.from({ length: 23 }, (_, i) => String(JSON.parse('"tag=a; id=k' + ((i * 7) % 11) + '"')));
const entries = new Map();
let missed = 0;
function touch(line, now) {
  const id = line.slice(line.indexOf("id=") + 3);
  const entry = entries.get(id);
  if (entry === undefined || now - entry.at > 9) {
    missed++;
    entries.set(id, { owner: id, at: now, hits: 1 });
    if (entries.size > 6) entries.delete(entries.keys().next().value);
    return 0;
  }
  entry.at = now;
  entry.hits++;
  entries.delete(id);
  entries.set(id, entry);
  return entry.hits + entry.owner.length;
}
let sum = 0;
for (let turn = 0; turn < 400; turn++) sum = (Math.imul(sum, 31) + touch(lines[turn % lines.length], turn)) | 0;
console.log(sum >>> 0, missed, [...entries.keys()].join(), [...entries.values()].map(one => one.owner + ":" + one.hits).join(), [...entries].every(([key, one]) => key === one.owner && entries.has(one.owner)));
