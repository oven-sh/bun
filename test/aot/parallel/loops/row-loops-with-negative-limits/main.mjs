class Shelf extends Array {
    refill(boxes, places) {
        let box = 0;
        for (; box < boxes; box++)
            this[box] = new Array(places);
        return box;
    }

    stock(boxes, day) {
        for (let box = 0; box < boxes; box++) {
            const row = this[box];
            for (let place = 0; place < row.length; place++)
                row[place] = day + place;
        }
        return boxes;
    }
}

const shelf = new Shelf();
for (let box = 0; box < 40; box++)
    shelf.push([box]);

const orders = [];
for (let day = 0; day < 4000; day++)
    orders.push(day % 41);
orders.push((process.argv.length - 90) | 0);

const held = [];
function work(boxes, places, day) {
    held[0] = boxes;
    held[1] = places;
    const given = day < 0 ? ["4", 3] : held;
    return shelf.refill(given[0], given[1]);
}

const marks = [];
let turns = 0;
let laid = 0;
for (let day = 0; day < orders.length; day++) {
    if (day === orders.length - 1) {
        for (let box = 0; box < 40; box++) {
            marks[box] = [box, box + 1];
            shelf[box] = marks[box];
        }
    }
    laid = work(orders[day], 1 + day % 3, day);
    shelf.stock(laid, day);
    turns += laid;
}

let kept = 0;
for (let box = 0; box < 40; box++) {
    if (shelf[box] === marks[box])
        kept++;
}
console.log(turns, orders[4000] < 0, "laid", laid, "kept", kept, "of", shelf.length);
