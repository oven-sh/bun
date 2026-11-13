const n: number = JSON.parse("300"), said: string[] = [];
function tell(list: unknown[]): string { let holes = 0; for (let i = 0; i < list.length; i++) if (!(i in list)) holes++; return list.length + ":" + String(list[1]) + ":" + String(list[list.length - 1]) + ":" + holes; }
for (const last of JSON.parse('["x", 0.5, null]').concat([NaN, undefined])) {
    const m = new Map<unknown, unknown>(), s = new Set<unknown>(); for (let i = 0; i < n; i++) { m.set(i, i * 2); s.add(i); }
    m.delete(0); m.delete(150); s.delete(0); s.delete(150); m.set(last, last); s.add(last);
    const values: any = m.values(), keys: any = m.keys(), members: any = s.values();
    said.push(tell([7, ...values]), tell([0.5, ...keys]), tell([7, ...members]), String(values.next().done && keys.next().done && members.next().done)); }
console.log(`SAID ${said.join(" ")}`); export {};
