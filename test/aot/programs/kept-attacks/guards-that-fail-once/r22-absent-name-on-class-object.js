// What a framework does with a component: it reads names that most classes do not have. no trip: the receivers are plain functions; trip: they are classes nobody has looked into.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 5000000);
const variant = process.argv[4] ?? "one";

class First { render() { return 1; } }
class Second { render() { return 2; } }
class Third extends First { static displayName = "third"; }
function first() { return 1; }
function second() { return 2; }
function third() { return 3; }
third.displayName = "third";

const classes = variant === "one" ? [First, First, First] : [First, Second, Third];
const functions = variant === "one" ? [first, first, first] : [first, second, third];
const receivers = trip ? classes : functions;
function describe(type) {
  return (type.defaultProps === undefined ? 1 : 0) + (type.contextType === undefined ? 1 : 0) + (type.displayName === undefined ? 1 : 0);
}
let sum = 0;
for (let i = 0; i < N; i++) sum += describe(receivers[i % 3]);
console.log(sum);
