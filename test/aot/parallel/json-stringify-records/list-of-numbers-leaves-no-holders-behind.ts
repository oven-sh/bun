// A list that may hold objects whose writing runs code, here holding numbers alone, leaves its builder without holders of a frame that has returned: the next value written with that builder would walk them.
{
    let out = "";
    function note(value: any): void { out += JSON.stringify(value) + ";"; }
    function replaceHundreds(a: { value: number }[]): any { let s: any = 0;  let i = 0; while (i < a.length) { if (a[i].value == 100) a[i] = { value: 3 }; s += a[i].value; i++; } return s; }
    try { const objects: any = Array.from({ length: 8 }, (_, at) => ({ value: at % 2 ? 100 : at })); note(replaceHundreds(objects)); note(objects); } catch (error) { note("threw " + (error as any)?.constructor?.name); }
    function raiseHalves(a: number[]): any { let s: any = 0;  let i = 0; while (i < a.length) { const first = a[i]; if (a[i] === 100.5) a[i] += 1; s += first + a[i]; i++; } return s; }
    try { const numbers: any = [100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 7.5, 8.5]; note(raiseHalves(numbers)); note(numbers); } catch (error) { note("threw " + (error as any)?.constructor?.name); }
    console.log(out);
}
{
    let out = "";
    function note(value: unknown): void { out += (typeof value === "symbol" || typeof value === "bigint" ? typeof value + " " + String(value) : typeof value === "function" ? "function" : (JSON.stringify(value) ?? "undefined")) + ";"; }
    interface Holder { a: number; member: { inner: number } | undefined }
    let record: Holder = { a: 1, member: undefined };
    record = { ...record, ...({ member: 10n } as any) };
    try { note(record); note([record]); note({ record }); } catch (error) { note("threw " + (error as any)?.name); }
    try { note(Object.entries(record).map(([key, value]) => key + ":" + typeof value).join()); const { member: taken } = record; note(taken); note({ ...record }.member); note(Object.values(record).length); } catch (error) { note("threw"); }
    console.log(out);
}
