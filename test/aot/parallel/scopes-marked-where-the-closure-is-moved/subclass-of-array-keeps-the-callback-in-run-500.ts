type Callback = (x: number) => number;

const kept: Callback[] = [];

class Bag extends Array<number> {
    keeps = false;

    forEach(callback: (value: number, index: number, array: number[]) => void, thisArg?: any): void {
        if (this.keeps) {
            kept.push(callback as unknown as Callback);
            return;
        }
        super.forEach(callback, thisArg);
    }
}

function sum(list: number[], run: number): number {
    let total = run;
    list.forEach(x => { total += x; return total; });
    return total;
}

const bag = new Bag();
bag.push(1, 2, 3, 4);
const plain: number[] = [1, 2, 3, 4];

let checksum = 0;
for (let run = 0; run < 1000; run++) {
    bag.keeps = run === 500;
    checksum = (checksum * 31 + sum(run % 2 ? plain : bag, run)) % 1000003;
}

console.log(checksum, kept.length);
console.log(kept[0](1), kept[0](10), kept[0](100));
console.log(sum(bag, 7), kept[0](0), sum(plain, 8), kept[0](0));
