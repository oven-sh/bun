// Hands objects whose member is a number, a text or a boolean to functions that expect a list there and list the member in a new literal, in front of a field that is stored once.
interface HoldsNumber { name: string; list: number[] }
interface FromNumber { list: number[]; ratio: number }
function listNumber(given: HoldsNumber): FromNumber {
    return { list: given.list, ratio: 0.125 };
}
listNumber({ name: "s", list: [1, 2] });
const asHolderOfNumber = (value: any): HoldsNumber => value;
const holdsNumber = asHolderOfNumber({ list: -1.5 });
for (let i = 0; i < 1; i++) console.log(listNumber(holdsNumber).ratio);

interface HoldsText { name: string; list: number[] }
interface FromText { list: number[]; ratio: number }
function listText(given: HoldsText): FromText {
    return { list: given.list, ratio: 0.25 };
}
listText({ name: "s", list: [1, 2] });
function pick<T>(value: unknown): T {
    return value as T;
}
const holdsText = pick<HoldsText>({ list: "text" });
for (let i = 0; i < 1; i++) {
    const made = listText(holdsText);
    console.log(typeof made.list, made.list, made.ratio);
}

interface HoldsBoolean { name: string; list: number[] }
interface FromBoolean { list: number[]; ratio: number }
function listBoolean(given: HoldsBoolean): FromBoolean {
    return { list: given.list, ratio: 0.5 };
}
listBoolean({ name: "s", list: [1, 2] });
const asHolderOfBoolean = (value: any): HoldsBoolean => value;
const holdsBoolean = asHolderOfBoolean({ list: true });
let last = listBoolean(holdsBoolean);
for (let i = 0; i < 100000; i++) last = listBoolean(holdsBoolean);
console.log(typeof last.list, last.list, last.ratio, Object.keys(last).join());

interface HoldsInteger { name: string; list: number[] }
interface FromInteger { list: number[]; ratio: number }
function listInteger(given: HoldsInteger): FromInteger {
    return { list: given.list, ratio: 0.75 };
}
listInteger({ name: "s", list: [1, 2] });
const asHolderOfInteger = (value: any): HoldsInteger => value;
const holdsInteger = asHolderOfInteger({ list: 3 });
for (let i = 0; i < 100000; i++) {
    const made = listInteger(holdsInteger);
    if (i % 50000 === 0) console.log(typeof made.list, made.ratio);
}
