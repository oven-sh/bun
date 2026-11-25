// a row of which nothing is written is taken apart: two names, and the rest, which is kept and read later. The names are this file's own.
const rows = Array.from({ length: 64 }, (_, i) => ({ serial: i, owner: "user" + (i % 7), branch: ["east", "west"][i & 1], years: 20 + (i % 45), wage: 1000 + i, marks: [i], busy: i % 3 !== 0, chief: i >> 1 }));
const kept = new Array(8).fill(null);
function written(row) { return { owner: row.owner, branch: row.branch, years: row.years, wage: row.wage, busy: row.busy, chief: row.chief }; }
function rest(row) { const { serial, marks, ...others } = row; return others; }
function read(it) { return it === null ? 0 : it.years + it.wage + it.owner.length + it.chief; }
export const loops = {
  "the other names written out": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { kept[i & 7] = written(rows[i & 63]); s = (s + read(kept[(i + 3) & 7])) | 0; } return s; },
  "the rest of a pattern": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { kept[i & 7] = rest(rows[i & 63]); s = (s + read(kept[(i + 3) & 7])) | 0; } return s; },
};
