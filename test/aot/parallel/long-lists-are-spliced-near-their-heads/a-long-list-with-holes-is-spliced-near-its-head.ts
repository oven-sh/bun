const n = 140000;
function make(): any[] { const list: any[] = []; for (let i = 0; i < n; i++) list.push(i); delete list[0]; delete list[3]; delete list[70000]; delete list[n - 1]; return list; }
function digest(list: any[]): string { let sum = 0, holes = 0; for (let i = 0; i < list.length; i++) { if (!(i in list)) holes++; else sum = (sum * 31 + list[i]) | 0; } return list.length + ":" + sum + ":" + holes + ":" + (0 in list) + ":" + (1 in list) + ":" + (2 in list) + ":" + (3 in list) + ":" + (4 in list); }
for (const at of [0, 1, 2, 3, 4, 5]) { const a = make(); const ra = a.splice(at, 1); const b = make(); b.splice(at, 0, -1); const c = make(); const rc = c.splice(at, 2); console.log(at, digest(a), ra.length, 0 in ra, digest(b), digest(c), rc.length, 0 in rc, 1 in rc); }
