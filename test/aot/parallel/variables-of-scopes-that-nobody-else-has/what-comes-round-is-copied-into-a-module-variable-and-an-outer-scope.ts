interface Row { id: number }

let last = 0;

function run(rows: Row[]): number {
    let count = 0;
    const bump = () => { count += 1; };
    let previous = 0;
    let work = 0;
    for (let i = 0; i < rows.length; i++) {
        work = work + previous;
        bump();
        last = count;
        previous = last;
    }
    return work * 1000 + previous + count;
}

function outer(rows: Row[]): number {
    let kept = 0;
    function inner(): number {
        let count = 0;
        const bump = () => { count += 1; };
        let previous = 0;
        let work = 0;
        for (let i = 0; i < rows.length; i++) {
            work = work + previous;
            bump();
            kept = count;
            previous = kept;
        }
        return work * 1000 + previous + count;
    }
    const first = inner();
    return first + inner() + kept;
}

const rows: Row[] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
console.log(run(rows), run(rows.slice(1)), last);
console.log(outer(rows), outer(rows.slice(2)), outer([]));
