// Every turn of the inner loop reads rows[r] anew. In the typed copy of that loop the row is read once, in front, behind a test that it is there, which fails to the other copy.
// Here a row is missing: a hole, undefined, null. With the test built and not branched on, the executable crashed.
const unseen = (x: any): any => [x][JSON.parse("0")];
function f(rows: number[][]): number { let s = 0; for (let r = 0; r < rows.length; r++) for (let i = 0; i < rows[r].length; i++) s += rows[r][i]; return s; }
const ask = (rows: any) => { try { return f(rows); } catch (e: any) { return e.constructor.name; } };
for (let n = 0; n < 3; n++) console.log(ask(unseen([[1.5, 2.5], , [3.5]])), ask(unseen([, [1.5]])), ask(unseen([[1.5], undefined])), ask(unseen([[1.5], null])));
