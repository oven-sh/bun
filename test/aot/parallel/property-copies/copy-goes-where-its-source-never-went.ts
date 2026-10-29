// A record that only typed code ever sees is copied by a literal written under a type parameter, and the COPY goes where the record never went: into code that nobody compiled with types,
// which deletes, redefines, freezes and stores values of other types. What the compiler knows about the record's type must not be taken for granted of the copy, nor the other way round.
type Account = { id: number; owner: string; balance: number; open: boolean; tags: string[] };
function clone<T>(source: T): T {
    return { ...source };
}
function patched<T extends { id: number }>(source: T, id: number): T {
    return { ...source, id };
}
const hidden = (0, eval)(`({
    remove(o, k) { delete o[k]; return o; },
    put(o, k, v) { o[k] = v; return o; },
    accessor(o, k, v) { Object.defineProperty(o, k, { get() { return v; }, enumerable: true, configurable: true }); return o; },
    hide(o, k) { Object.defineProperty(o, k, { enumerable: false }); return o; },
    freeze(o) { return Object.freeze(o); },
    below(o, p) { return Object.setPrototypeOf(o, p); },
    same(a, b) { return a === b; },
})`) as {
    remove<T>(o: T, k: string): T; put<T>(o: T, k: string, v: unknown): T; accessor<T>(o: T, k: string, v: unknown): T; hide<T>(o: T, k: string): T;
    freeze<T>(o: T): T; below<T>(o: T, p: object | null): T; same(a: unknown, b: unknown): boolean;
};
function total(account: Account): string {
    return account.id + "/" + account.owner + "/" + account.balance + "/" + account.open + "/" + (account.tags ? account.tags.length : "none");
}
const lines: string[] = [];
function say(title: string, source: Account, copy: Account) {
    lines.push(title + ": " + total(source) + " | " + total(copy) + " | " + Object.keys(source).join() + " | " + Object.keys(copy).join() + " | " + JSON.stringify(copy));
}
const make = (id: number): Account => ({ id, owner: "o" + id, balance: id * 10, open: true, tags: ["a"] });

// One record that is made once, at the top of the module.
const single = make(1);
const twin = clone(single);
lines.push("identity: " + (single === twin) + " " + hidden.same(single, twin) + " " + (clone(twin) === twin) + " " + (patched(single, 1) === single));
twin.balance = 99;
say("a store into the twin", single, twin);
single.owner = "changed";
say("a store into the single one", single, twin);

for (let round = 0; round < 40; round++) {
    const source = make(round);
    const title = "round " + round + " ";
    switch (round % 10) {
    case 0: say(title + "removed", source, hidden.remove(clone(source), "balance")); break;
    case 1: say(title + "text in a number", source, hidden.put(clone(source), "balance", "much")); break;
    case 2: say(title + "undefined in a string", source, hidden.put(patched(source, -1), "owner", undefined)); break;
    case 3: say(title + "accessor", source, hidden.accessor(clone(source), "id", 1000)); break;
    case 4: say(title + "hidden", source, hidden.hide(patched(source, -2), "open")); break;
    case 5: { const copy = hidden.freeze(clone(source)); try { copy.balance = 5; } catch (error) { lines.push((error as Error).constructor.name); } say(title + "frozen", source, copy); break; }
    case 6: say(title + "below another object", source, hidden.below(hidden.remove(clone(source), "owner"), { owner: "inherited" })); break;
    case 7: say(title + "a new name", source, hidden.put(clone(source), "added", round)); break;
    case 8: say(title + "removed and put back", source, hidden.put(hidden.remove(clone(source), "id"), "id", 7)); break;
    case 9: say(title + "a copy of a changed copy", source, clone(hidden.put(hidden.remove(clone(source), "tags"), "balance", null))); break;
    }
}
console.log(lines.join("\n"));
