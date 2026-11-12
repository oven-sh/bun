// answers: without-library
// # A getter or a setter that an operation lays on a literal or on a class object is entered by a read, a store or a copy, where no call is written. What it reads of the module in front of the store is in its dead zone.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const literal = { get rate() { return lateForGetter.rate; }, set rate(value) { seen = lateForSetter.rate + value; } };
class Early { static get rate() { return lateForStatic.rate; } static set rate(value) { seen = lateForStaticSetter.rate + value; } }
let seen;
function read() { return literal.rate; }
function store() { literal.rate = 1; return seen; }
function readStatic() { return Early.rate; }
function storeStatic() { Early.rate = 2; return seen; }
function readByPattern() { const { rate } = literal; return rate; }
function readBySpread() { return { ...literal }.rate; }
function readNumber() { return holderOfNumber.rate; }
const holderOfNumber = { get rate() { return lateNumber; } };
report(attempt(read));
report(attempt(store));
report(attempt(readStatic));
report(attempt(storeStatic));
report(attempt(readByPattern));
report(attempt(readBySpread));
report(attempt(readNumber));
const lateForGetter = { rate: 0.25 };
const lateForSetter = { rate: 0.5 };
const lateForStatic = { rate: 0.75 };
const lateForStaticSetter = { rate: 1.5 };
const lateNumber = 7;
report(attempt(read));
report(attempt(store));
report(attempt(readStatic));
report(attempt(storeStatic));
report(attempt(readByPattern));
report(attempt(readBySpread));
report(attempt(readNumber));
report("end");
