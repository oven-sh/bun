// Every kind of place that holds a value of a union of string literals.
type State = "idle" | "running" | "done";
enum Level { Low = "low", High = "high" }

let current: State = "idle";
let maybe: State | undefined;
const fixed = "done";

class Task {
    static shared: State = "idle";
    state: State = "idle";
    last: State | null = null;
    level: Level = Level.Low;
    #hidden: State = "running";
    constructor(public readonly first: State) {}
    advance(): State {
        this.last = this.state;
        this.state = this.state === "idle" ? "running" : "done";
        return this.state;
    }
    get hidden(): State { return this.#hidden; }
    set hidden(to: State) { this.#hidden = to; }
}
function counter(start: State): () => State {
    let held = start;
    return () => {
        const was = held;
        held = held === "idle" ? "running" : held === "running" ? "done" : "idle";
        return was;
    };
}
function* states(): Generator<State, State, State | undefined> {
    const back = yield "idle";
    yield back ?? "running";
    return "done";
}
async function later(s: State): Promise<State> {
    const now = s;
    await null;
    return now === "idle" ? "running" : now;
}
function pair(a: State, b: State = "done"): [State, State] {
    return [b, a];
}
function pick({ state, last }: Task, ...rest: State[]): string {
    return state + ":" + last + ":" + rest.length + ":" + rest.join("");
}
function level(l: Level): number {
    switch (l) {
        case Level.Low: return 1;
        case Level.High: return 2;
    }
}

const task = new Task("running");
console.log(task.state, task.last, task.first, task.hidden, task.level, level(task.level), Task.shared);
console.log(task.advance(), task.advance(), task.advance(), task.last);
task.hidden = "done";
task.level = Level.High;
Task.shared = task.state;
console.log(task.hidden, level(task.level), task.level === Level.High, Task.shared, JSON.stringify(task));
const next = counter("idle");
console.log(next(), next(), next(), next());
const g = states();
console.log(g.next().value, g.next("done").value, g.next().value, g.next().value);
console.log(pair("idle").join(), pair("idle", "running").join(), pick(task), pick(task, "idle", "done"));
console.log(current, maybe, fixed, maybe === undefined, current === "idle", fixed === "done");
current = task.state;
maybe = current;
console.log(current, maybe, maybe === current, maybe !== undefined);
maybe = undefined;
console.log(maybe ?? "nothing", maybe === "idle");
later("idle").then(async s => {
    console.log(s, await later(s), await later("done"));
    const all = await Promise.all([later("idle"), later("running")]);
    console.log(all.join());
});
