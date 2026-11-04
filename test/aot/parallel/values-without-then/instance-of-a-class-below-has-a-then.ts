// an instance of a class below, which has a `then`, arrives where the class above is written
const log: string[] = [];
class Point {
    x: number;
    constructor(x: number) {
        this.x = x;
    }
}
class Later extends Point {
    then(resolve: (value: Point) => void) {
        log.push("then of " + this.x);
        resolve(new Point(this.x * 100));
    }
}
async function wait(point: Point, turns: number) {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
        const held = await point;
        sum += held.x;
        log.push("turn " + i + " " + sum);
    }
    return sum;
}
function deed(): Point {
    return new Later(2);
}
log.push(String(await wait(new Point(1), 3)));
log.push(String(await wait(deed(), 3)));
log.push(String(await wait(new Point(3), 2)));
console.log(log.join("\n"));
export {};
