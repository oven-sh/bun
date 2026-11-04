// `a + "," + b`: the second `+` takes the two parts of the first rope and adds its own. Numbers, narrow and wide texts, empty ones, slices, ropes of three, a rope joined to itself; each text is a key of a Map too.
function any<T>(x: T): T { return (globalThis as any).hidden ? (undefined as any) : x; }
const parts: any[] = [];
for (let i = 0; i < 40; i++) parts.push(any(i % 3 === 0 ? i * 1001 : i % 3 === 1 ? "p" + i : "é中" + i));
const seen = new Map<string, number>();
let out = "";
for (let i = 0; i + 3 < parts.length; i++) {
    const a = any(parts[i]), b = any(parts[i + 1]), c = any(parts[i + 2]), d = any(parts[i + 3]);
    const two = a + "," ;
    const three = two + b;
    const four = three + c;
    const five = four + "|" + d;
    const sliced = any(five).substring(1, 9) + a + b;
    const empty = any("") + a + any("") + b + any("");
    for (const k of [two, three, four, five, sliced, empty, two + two, three + three + three]) seen.set(k, (seen.get(k) ?? 0) + k.length);
    out += three.length + ":" + five.charCodeAt(five.length - 1) + ";" + two;
}
let sum = 0;
for (const [k, v] of seen) sum = (sum * 31 + v + k.charCodeAt(k.length >> 1)) | 0;
console.log(seen.size, sum, out.length, out.slice(-40));
