// A variable holds `undefined` before anything is assigned to it, and that value can flow into inferred results and unannotated variables.
const show = (...values: unknown[]) => console.log(values.map(String).join(" "))
function direct() { return n }
function conditional(c: boolean) { return c ? n : 0 }
function and(c: boolean) { return c && n }
function or() { return n || -1 }
function nullish() { return n ?? -2 }
function assigned() { let copy; return copy = n }
function kept() { const copy = n; return copy }
function through() { return direct() }
function sum() { return direct() + 1 }
function text() { return s }
function flag() { return b }
const arrow = () => n
function all() { show(direct(), conditional(true), conditional(false), and(true), and(false), or(), nullish(), assigned(), kept(), through(), sum(), text(), flag(), arrow()) }
all()
var n = 7, s = "s", b = true
all()
// In a loop the second iteration finds what the first has stored.
function rounds() { const seen = []; for (let i = 0; i < 2; i++) { seen.push(peek()); var round = i + 1 } return seen; function peek() { return round } }
show(...rounds())
