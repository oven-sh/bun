// STATISTIC: ShadowedMethodsKeepingIterations >= 1
// A method that the program stores on some instances: the loop asks in an arm of its own and goes on.
const box = JSON.parse("{}");
const [key] = JSON.parse('["hidden"]');
function hide(value) {
    box[key] = value;
    return box[key];
}
class Rules {
    constructor() { this.used = 0; this.names = []; }
    derive(request) {
        const found = this.find(request);
        this.used++;
        return found === undefined ? "none" : found;
    }
    find(request) { return undefined; }
    rebuild(names) {
        if (!names.length)
            return;
        this.names = names;
        this.find = new Function("request", "return " + names.map(name => "request." + name).join(" + '/' + "));
    }
    forget() { delete this.find; }
}
class Router {
    constructor() { this.rules = new Rules(); this.seen = 0; }
    lookup(request) { const text = this.rules.derive(request) + request.url; this.seen += 1; return text; }
}
const router = new Router();
const requests = hide([{ url: "/a", host: "x" }, { url: "/bc", host: "yz" }]);
function run(times) {
    let sum = 0;
    for (let i = 0; i < times; i++) {
        const text = router.lookup(requests[i & 1]);
        for (let j = 0; j < text.length; j++)
            sum = (sum * 31 + text.charCodeAt(j)) | 0;
    }
    return sum;
}
console.log("as declared", run(40), router.seen, router.rules.used);
router.rules.rebuild(["host"]);
console.log("stored", run(40), router.seen, router.rules.used);
router.rules.forget();
console.log("deleted", run(40), router.seen, router.rules.used);
router.rules.find = function (request) { if (this.used % 7 === 3) throw new Error("no " + request.url); return this.names.length; };
let caught = 0;
for (let k = 0; k < 9; k++) {
    try {
        run(5);
    } catch (error) {
        caught += error.message.length;
    }
}
console.log("throws", caught, router.seen, router.rules.used);
Object.defineProperty(router.rules, "find", { get() { const { used } = this; return request => used + request.host; }, configurable: true });
console.log("getter", run(10), router.seen, router.rules.used);
Object.defineProperty(router.rules, "find", { value: request => { router.rules = new Rules(); return "last" + request.url; }, configurable: true });
console.log("replaced in the middle", run(10), router.seen, router.rules.used);
