// `comparator.test(new Range())`: the name is RegExp.prototype.test's, the receiver is an instance of a class of the program, and the operand is made between the read and the call
class Comparator { test(range) { return range instanceof Range; } exec(range) { return [range instanceof Range]; } get(k) { return "c:" + k; } push(v) { return "p:" + v; } }
class Range { holds(comparator) { return comparator instanceof Comparator; } test(c) { return this.holds(c); } }
const things = [new Comparator(), new Range(), /ab/, { test: v => "own " + typeof v }, Object.create(new Comparator())];
function make(i) { return i & 1 ? new Comparator() : new Range(); }
for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < things.length; i++) {
        let answer;
        try { answer = things[i].test(make(i + turn)); } catch (e) { answer = e.name; }
        console.log(turn, i, String(answer));
    }
}
for (const thing of [new Comparator(), new Map([["k", 1]]), [], "text", {}, null]) {
    for (const name of ["get", "push", "exec"]) {
        let answer;
        try { answer = name === "get" ? thing.get(String("k")) : name === "push" ? thing.push(make(1) && 4) : thing.exec(make(0)); } catch (e) { answer = e.name; }
        console.log(name, String(answer));
    }
}
