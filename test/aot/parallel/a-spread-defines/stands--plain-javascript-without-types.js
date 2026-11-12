function withMore(base, more) { return { ...base, ...more, stamped: true }; }
for (let turn = 0; turn < 4; turn++) {
    const result = withMore({ a: turn, b: "b" }, turn & 1 ? { b: 2, c: [turn] } : { a: "over" });
    console.log(JSON.stringify(result), Object.keys(result).join());
}
