// Between the making of a list literal and its join the list is stored into, made longer and shorter, given a getter on an index, a join of its own, another prototype, or is frozen.
function joined(a: string, b: string, change: (list: string[]) => void): string {
    const list = [a, b];
    change(list);
    return list.join("-");
}

function straight(a: string, b: string, how: number): string {
    const list = [a, b];
    if (how === 1)
        list[0] = b;
    if (how === 2)
        list[3] = a;
    if (how === 3)
        list.length = 1;
    if (how === 4)
        delete list[0];
    return list.join("-");
}

function deed(name: string, change: (list: string[]) => void) {
    console.log(name, joined("a", "b", change));
}

for (let how = 0; how < 5; how++)
    console.log(how, straight("a", "b", how));
deed("nothing", () => {});
deed("store", list => { list[1] = "stored"; });
deed("push", list => { list.push("pushed"); });
deed("pop", list => { list.pop(); });
deed("far", list => { list[4] = "far"; });
deed("getter", list => { Object.defineProperty(list, 0, { get() { return "got"; } }); });
deed("own join", list => { (list as any).join = (separator: string) => "own" + separator; });
deed("prototype", list => { Object.setPrototypeOf(list, { join() { return "below"; } }); });
deed("hole above", list => { delete list[0]; Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { 0: "inherited" })); });
deed("frozen", list => { Object.freeze(list); });
deed("nothing", () => {});
