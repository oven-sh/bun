type Callback = (x: number) => string;

const kept: Callback[] = [];

function fold(list: number[], run: number, collects: boolean): string {
    let total = run;
    let text = "t";
    list.forEach(x => {
        if (collects)
            Bun.gc(true);
        total += x;
        text += x;
        return `${total} ${text}`;
    });
    return `${total} ${text}`;
}

const list: number[] = [1, 2, 3];
let lengths = 0;
for (let run = 0; run < 1000; run++) {
    if (run % 100 === 50)
        (list as any).forEach = function (callback: Callback) { kept.push(callback); };
    if (run % 100 === 51)
        delete (list as any).forEach;
    if (run % 100 === 52)
        Bun.gc(true);
    lengths += fold(list, run, run % 97 === 0).length;
}
console.log(lengths, kept.length);

Bun.gc(true);
for (const callback of kept)
    console.log(callback(1));
for (let run = 0; run < 100; run++)
    lengths += fold(list, run, false).length;
Bun.gc(true);
for (let run = 0; run < 100; run++)
    lengths += fold(list, run, run === 50).length;
for (const callback of kept)
    console.log(callback(2));
console.log(lengths);
