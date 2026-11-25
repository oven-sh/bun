const said: string[] = [];
function even(cells: any[]): number { let t = 0; for (let j = 0; j < cells.length; j++) { const cell = cells[j]; if ((cell & 1) === 0) t++; } return t; }
function sum(cells: any[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j] & 7; return t; }
function make(deed: (l: any[]) => void, at: number): any[] { const l: any[] = []; for (let i = 0; i < 20; i++) l.push(i); l[at] = { valueOf() { said.push("asked at " + at); deed(l); return 2; } }; return l; }
const deeds: [string, (l: any[]) => void][] = [
  ["shortens", l => { l.length = 5; }], ["grows", l => { if (l.length < 40) l.push(1, 3, 5); }], ["stores a fraction", l => { l[l.length - 1] = 0.5; }], ["stores a text", l => { l[l.length - 1] = "3"; }],
  ["deletes the next", l => { delete l[10]; }], ["deletes all behind", l => { for (let i = 9; i < l.length; i++) delete l[i]; }], ["stores far out", l => { l[5000] = 1; }], ["throws", () => { throw new RangeError("no"); }],
];
for (const [name, deed] of deeds) for (const at of [0, 3, 8, 15]) {
  let a: unknown, b: unknown; try { a = even(make(deed, at)); } catch (e) { a = (e as Error).message; } try { b = sum(make(deed, at)); } catch (e) { b = (e as Error).message; }
  console.log(name, at, a, b, said.length); said.length = 0;
}
