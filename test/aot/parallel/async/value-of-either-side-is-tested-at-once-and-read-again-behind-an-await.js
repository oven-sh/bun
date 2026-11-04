// an async function takes a value from either of two sides, tests it at once, and reads it again behind an await
async function subject(c, o) { const v = c ? 1 : o.n; let kind = "other"; if (typeof v === "number") kind = "number"; await null; return kind + ":" + String(v); }
async function deed() {
    const cold = [await subject(true, { n: 2 }), await subject(false, { n: 2 }), await subject(0, { n: "x" }), await subject(1, null)];
    console.log(cold.join());
    let lengths = 0;
    for (let i = 0; i < 300; i++) lengths += (await subject(i % 3, { n: i % 2 ? i : "t" + i })).length;
    console.log(String(lengths));
    console.log(await subject(JSON.parse("0"), { n: undefined }));
}
deed();
