const unseen = (x: any): any => [x][JSON.parse("0")];
function take(n: number): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof n + ":" + String(n) + work; }
interface Row { id: number } const r: Row = JSON.parse('{"id":"7"}'); console.log(take(r.id));
