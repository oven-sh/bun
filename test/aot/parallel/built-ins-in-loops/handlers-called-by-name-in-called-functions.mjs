// A table of functions is called under a key by a function that a loop calls: the key is told apart by the names of the table.
// STATISTIC: AccessesDispatchedByKeyString >= 2
const tree = { kind: "add", left: { kind: "number", value: 2 }, right: { kind: "multiply", left: { kind: "number", value: 3 }, right: { kind: "negate", operand: { kind: "number", value: 4 } } } };
const visitors = {
    number: node => node.value,
    add: node => evaluate(node.left) + evaluate(node.right),
    multiply: node => evaluate(node.left) * evaluate(node.right),
    negate: node => -evaluate(node.operand),
    failing() { throw new Error("failing " + (this === visitors)); },
};
function evaluate(node) {
    return visitors[node.kind](node);
}
let calls = 0;
const commands = {
    push(stack, argument) { calls++; stack.push(argument); },
    pop(stack) { calls += 2; return stack.pop(); },
    get size() { return () => "size"; },
    count(stack) { return this === commands ? stack.length : -1; },
};
function execute(stack, name, argument) {
    const result = commands[name](stack, argument);
    return result === undefined ? "nothing" : result;
}
const log = [];
for (let turn = 0; turn < 40; turn++) {
    try {
        log.push(evaluate(tree));
    } catch (error) {
        log.push(error.constructor.name);
    }
    const stack = [];
    log.push(execute(stack, "push", turn), execute(stack, "push", "x" + turn), execute(stack, "count"), execute(stack, "pop"), execute(stack, ["co", "unt"].join("")), execute(stack, "size"));
    for (const key of ["failing", "missing", "toString", "constructor", "__proto__", 5, Symbol.iterator, null, undefined]) {
        try {
            log.push(String(evaluate({ kind: key })));
        } catch (error) {
            log.push(error.constructor.name);
        }
    }
    if (turn === 20) visitors.add = node => evaluate(node.left) - evaluate(node.right);
    if (turn === 25) visitors.missing = () => "found";
    if (turn === 30) delete visitors.negate;
    if (turn === 32) visitors.negate = () => 100;
    if (turn === 35) Object.setPrototypeOf(visitors, { late: () => "late" });
    if (turn >= 35) log.push(evaluate({ kind: "late" }));
    if (turn === 36) Object.defineProperty(visitors, "number", { get() { return node => node.value * 2; } });
    if (turn === 38) Object.setPrototypeOf(commands, { drop: () => "dropped" }), log.push(execute(stack, "drop"));
}
console.log(calls, log.join());
console.log(Object.keys(visitors).join(), log.length);
