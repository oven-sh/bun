type Callback = (x: number) => string;

const kept: Callback[] = [];

function fold(list: number[], run: number): string {
    let a = run;
    let b = "b";
    list.forEach(x => { a += x; b += x; return `${a} ${b}`; });
    return `${a} ${b}`;
}

const list: number[] = [1, 2, 3];
let lengths = 0;
let last = "";
for (let run = 0; run < 1000; run++) {
    if (run % 250 === 100)
        (list as any).forEach = function (callback: Callback) { kept.push(callback); callback(1000); };
    if (run % 250 === 101)
        delete (list as any).forEach;
    last = fold(list, run);
    lengths += last.length;
}

console.log(lengths, last, kept.length);
for (const callback of kept)
    console.log(callback(0), callback(1));
console.log(fold(list, 1), kept[0](0), fold(list, 2), kept[3](0));
