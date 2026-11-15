function Holder(seed) {
    this.first = "first " + seed;
    this.second = "second " + seed;
    this.on = (seed & 1) === 1;
    this.inner = { seed };
}

function finish(holder, seed) {
    holder.late = seed;
    holder.later = "later " + seed;
    holder.latest = { seed: seed + 1 };
    return holder;
}

function finishHalf(holder, seed) {
    holder.later = "only later " + seed;
    return holder;
}

function show(holder) {
    return [holder.first, holder.second, String(holder.on), String(holder.inner.seed), String(holder.late), String(holder.later), holder.latest ? String(holder.latest.seed) : String(holder.latest)].join(" | ");
}

function collect() {
    let garbage = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(finish(new Holder(i), i));
    garbage = [];
    Bun.gc(true);
}

const bare = new Holder(1);
const whole = finish(new Holder(2), 2);
const half = finishHalf(new Holder(3), 3);
console.log("bare", show(bare), Object.keys(bare).join(","));
console.log("whole", show(whole), Object.keys(whole).join(","));
console.log("half", show(half), Object.keys(half).join(","));
collect();
console.log("bare", show(bare));
console.log("whole", show(whole));
console.log("half", show(half));

whole.late = 2.5;
console.log("a fraction", show(whole));
whole.late = "a text";
console.log("a text", show(whole));
whole.later = 7;
console.log("a number", show(whole));
whole.latest = null;
console.log("null", show(whole));
whole.first = "changed";
whole.on = false;
console.log("the first names", show(whole), Object.keys(whole).join(","));
collect();
console.log("collected", show(whole));

delete whole.late;
console.log("deleted", show(whole), Object.keys(whole).join(","), String("late" in whole));
whole.late = 9;
console.log("stored again", show(whole), Object.keys(whole).join(","));
finish(half, 30);
console.log("finished late", show(half), Object.keys(half).join(","));
finish(bare, 10);
console.log("finished late", show(bare), Object.keys(bare).join(","));
collect();
console.log("collected", show(half));
console.log("collected", show(bare));
console.log("json", JSON.stringify(bare));
console.log("copy", show({ ...half }), Object.keys({ ...half }).join(","));

const many = [];
for (let i = 0; i < 300; i++) {
    const holder = new Holder(i);
    many.push(i % 3 === 0 ? holder : i % 3 === 1 ? finish(holder, i) : finishHalf(holder, i));
    if (i % 100 === 99)
        collect();
}
let sum = 0;
for (const holder of many)
    sum += holder.first.length + holder.inner.seed + (holder.late === undefined ? 0 : holder.late) + (holder.later === undefined ? 0 : holder.later.length) + (holder.latest ? holder.latest.seed : 0);
console.log("sum", String(sum));
