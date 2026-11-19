function holder() { return 0; }
let calls = 0;
holder.run = function (step: number) { calls += step; return calls; };
for (let turn = 1; turn < 4; turn++) {
    const copy = { ...holder };
    console.log(copy.run(turn), calls);
}
