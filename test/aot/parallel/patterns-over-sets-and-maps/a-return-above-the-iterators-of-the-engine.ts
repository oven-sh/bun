// A pattern that takes fewer members than there are closes its iterator: it calls the `return` it finds above it. The iterators of
// lists, sets, maps and texts have none. Whoever lays one above them is either refused, aloud, or every close calls it: never
// is it laid and passed over in silence. Asked for each of the objects above them, each way of laying it, each kind.
const kinds: [string, () => any][] = [["list", () => [1, 2, 3]], ["set", () => new Set([4, 5, 6])], ["map", () => new Map([[7, 8], [9, 10], [11, 12]])], ["text", () => "xyz"]];
function takeOne(values: any) { const [first] = values; return String(first); }
function takeTwoInLoop(values: any) { let all = ""; for (let turn = 0; turn < 3; turn++) { const [first, second] = values; all += first + "," + second + ";"; } return all; }
function takeAll(values: any) { const [first, second, third, fourth] = values; return [first, second, third, fourth].join("|"); }
function leaveLoopEarly(values: any) { let seen = ""; for (const value of values) { seen += value; break; } return seen; }
let closes = 0;
const method = function () { closes++; return {}; };
const ways: [string, (holder: any) => void][] = [
    ["stored", holder => { holder.return = method; }],
    ["defined", holder => { Object.defineProperty(holder, "return", { value: method, configurable: true, writable: true }); }],
    ["defined as a getter", holder => { Object.defineProperty(holder, "return", { get: () => method, configurable: true }); }],
    ["by Reflect.set", holder => { if (!Reflect.set(holder, "return", method)) throw new TypeError("refused"); }],
    ["by Object.assign", holder => { Object.assign(holder, { return: method }); }],
    ["through another prototype", holder => { Object.setPrototypeOf(holder, Object.create(Object.getPrototypeOf(holder), { return: { value: method, configurable: true } })); }],
];
for (const [nameOfKind, make] of kinds) {
    const own = Object.getPrototypeOf(make()[Symbol.iterator]());
    const holders: [string, any][] = [["its iterators' prototype", own], ["the prototype of all iterators", Object.getPrototypeOf(own)], ["Object.prototype", Object.prototype]];
    for (const [nameOfHolder, holder] of holders) {
        for (const [nameOfWay, lay] of ways) {
            const above = Object.getPrototypeOf(holder);
            let isLaid = true;
            try { lay(holder); } catch { isLaid = false; }
            const before = closes;
            let said = "";
            try { const values = make(); said = takeOne(values) + " " + takeTwoInLoop(values) + " " + takeAll(values) + " " + leaveLoopEarly(values); }
            finally { if (isLaid) { if (Object.getPrototypeOf(holder) !== above) Object.setPrototypeOf(holder, above); else delete holder.return; } }
            const holds = isLaid ? closes - before === 5 : closes === before;
            console.log(nameOfKind + " . " + nameOfHolder + " . " + nameOfWay + ": " + said + " . " + (holds ? "refused aloud or called at every close" : "LAID AND PASSED OVER: " + (closes - before) + " of 5"));
        }
    }
}
