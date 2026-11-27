// routes are tried in a row.
const routes = [], paths = JSON.parse('["/users/7","/posts/8/edit","/about","/none"]'), key = JSON.parse('["byIndex","byForOf"]');
for (const [pattern, id] of [["/users/:id", 1], ["/posts/:id/edit", 2], ["/about", 3]]) routes.push({ parts: pattern.split("/"), id });
function fits(parts, asked) { if (parts.length !== asked.length) return false; for (let i = 0; i < parts.length; i++) if (parts[i][0] !== ":" && parts[i] !== asked[i]) return false; return true; }
const table = {
  byIndex(path, all) { const asked = path.split("/"); for (let i = 0; i < all.length; i++) if (fits(all[i].parts, asked)) return all[i].id; return 0; },
  byForOf(path, all) { const asked = path.split("/"); for (const route of all) if (fits(route.parts, asked)) return route.id; return 0; },
};
export const loops = {
  "routes tried by index": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[0]](paths[i & 3], routes))) | 0; return s; },
  "routes tried by a for-of": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[1]](paths[i & 3], routes))) | 0; return s; },
};
