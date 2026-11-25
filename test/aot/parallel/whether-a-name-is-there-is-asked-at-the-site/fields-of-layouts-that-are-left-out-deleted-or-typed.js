class Part { constructor(rank, mark) { this.rank = rank; if (mark !== undefined) this.mark = mark; } }
class Wide extends Part { constructor(rank, mark) { super(rank, mark); this.width = rank * 2; } get seen() { return 1; } shown() { return 2; } }
function make(kind, rank) { return kind === 0 ? { rank, mark: rank } : kind === 1 ? { rank, mark: "text" } : kind === 2 ? { rank } : kind === 3 ? { mark: 0.5, rank, more: 1 } : { more: 1, most: 2, rank, mark: null }; }
function markIsIn(thing) { return "mark" in thing; }
function markIsOwn(thing) { return Object.hasOwn(thing, "mark"); }
function seenIsIn(thing) { return "seen" in thing; }
function seenIsOwn(thing) { return Object.hasOwn(thing, "seen"); }
function shownIsIn(thing) { return "shown" in thing; }
function shownIsOwn(thing) { return Object.prototype.hasOwnProperty.call(thing, "shown"); }
function rankIsIn(thing) { return "rank" in thing; }
const asks = [markIsIn, markIsOwn, seenIsIn, seenIsOwn, shownIsIn, shownIsOwn, rankIsIn];
function line(label, thing) { console.log(label, asks.map(ask => { let yes = 0; for (let turn = 0; turn < 300; turn++) if (ask(thing)) yes++; return yes; }).join(" ")); }

line("a part with the field", new Part(1, 2));
line("a part that leaves it out", new Part(1));
const late = new Part(1);
line("left out", late);
late.mark = 3;
line("written late", late);
delete late.mark;
line("deleted", late);
late.mark = "again";
line("written again", late);
delete late.rank;
line("an integer field deleted", late);
line("a wide part", new Wide(1, 2));
line("a wide part that leaves it out", new Wide(1));
const own = new Wide(1);
own.shown = 1;
Object.defineProperty(own, "seen", { value: 1 });
line("the names above laid on the object itself", own);
for (let kind = 0; kind < 5; kind++)
    line("a record of kind " + kind, make(kind, kind));
let sum = 0;
for (let turn = 0; turn < 4000; turn++) {
    const thing = turn % 7 < 5 ? make(turn % 7, turn) : turn % 7 === 5 ? new Part(turn, turn & 1 ? turn : undefined) : new Wide(turn, turn & 2 ? turn : undefined);
    for (let index = 0; index < asks.length; index++)
        if (asks[index](thing)) sum += index + 1;
}
console.log(sum);
Wide.prototype.mark = 1;
line("the class above gets the name", new Wide(1));
line("a part beside it", new Part(1));
delete Wide.prototype.shown;
line("the class above loses a method", new Wide(1));
