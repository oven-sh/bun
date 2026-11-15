type Wide = { first: number; second: string };
type Narrow = { first: number };
function narrowed(record: Wide): Narrow { const copy: Narrow = { ...record }; return copy; }
for (let turn = 0; turn < 3; turn++) {
    const copy = narrowed({ first: turn, second: "kept" });
    console.log(Object.keys(copy).join(), (copy as any).second, JSON.stringify(copy));
}
