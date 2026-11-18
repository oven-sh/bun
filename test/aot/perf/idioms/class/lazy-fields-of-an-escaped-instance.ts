import { nextTurns } from "../host.ts";
let sink: unknown;
interface History { length: number }
interface Options { strict?: boolean; limit?: number; base?: string; tree?: object; history?: History; origin?: string }
class Settings {
    id: number;
    listeners: unknown[];
    update: (next: Options) => void;
    options?: Options;
    strict?: boolean;
    history?: History;
    origin?: string;
    base?: string;
    prefix?: string;
    tree?: object;
    stores?: { at: History };
    constructor(given: Options) {
        this.id = 1;
        this.listeners = [];
        this.update = (next: Options) => {
            const before = this.options;
            this.options = { ...before, ...next };
            this.strict = this.options.strict ?? true;
            if (!this.history || (this.options.history && this.options.history !== this.history)) {
                if (this.options.history) this.history = this.options.history;
            }
            this.origin = this.options.origin;
            if (!this.origin) this.origin = "local";
            const base = this.options.base ?? "/";
            if (this.base !== base || before?.strict !== this.options.strict) {
                this.base = base;
                this.prefix = base === "/" ? undefined : base;
            }
            if (this.options.tree !== this.tree) this.tree = this.options.tree;
            if (!this.stores && this.history) this.stores = { at: this.history };
        };
        this.update({ strict: false, limit: 50, ...given });
    }
}
const never = process.argv.length > 99;
const leak = new Function("o", "globalThis.kept = o" + (never ? ";" : ""));
const tree = { root: true }, history: History = { length: 1 };
const first: Options = { base: "/", tree }, second: Options = { history };
function make(): Settings {
    const settings = new Settings(first);
    if (never) leak(settings);
    settings.update(second);
    return settings;
}
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const settings = make();
        sink = settings;
        s += settings.base!.length + settings.stores!.at.length + settings.options!.limit!;
    }
    return s;
}
sink = [bench, make];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check, typeof sink);
