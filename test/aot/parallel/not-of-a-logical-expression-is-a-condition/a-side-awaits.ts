// a side awaits
async function later<T>(value: T): Promise<T> { await null; return value; }
async function ask(a: any, b: any): Promise<boolean> { return !!(await later(a) && (await later(b) || a)); }
for (const a of [0, 1, "", {}]) for (const b of [0, "x", null]) console.log(String(a), String(b), await ask(a, b));
