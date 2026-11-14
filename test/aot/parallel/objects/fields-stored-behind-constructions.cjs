// STATISTIC: OrdersBehindConstructions >= 1
// Fields that a method stores on an object that it has just constructed: the keys of the constructor come first.
"use strict";
var State = (function () {
    function State(rule, dot, reference, wantedBy) {
        this.rule = rule;
        this.dot = dot;
        this.reference = reference;
        this.data = [];
        this.wantedBy = wantedBy;
        this.isComplete = this.dot === rule.symbols.length;
    }
    State.prototype.nextState = function (child) {
        var state = new State(this.rule, this.dot + 1, this.reference, this.wantedBy);
        state.left = this;
        state.right = child;
        if (state.isComplete) {
            state.data = state.build();
            state.right = undefined;
        }
        return state;
    };
    State.prototype.build = function () {
        var children = [], node = this;
        do {
            children.push(node.right.data);
            node = node.left;
        } while (node.left);
        children.reverse();
        return children;
    };
    return State;
})();
var box = JSON.parse("{}");
var key = JSON.parse('["hidden"]')[0];
function hide(value) {
    box[key] = value;
    return box[key];
}
function parse(symbols, start) {
    var state = hide(new State(hide({ symbols: symbols }), start, 0, []));
    for (var i = 0; i < symbols.length; i++)
        state = state.nextState({ data: symbols[i] });
    return state;
}
function show(state) {
    var word = Object.keys(state).join() + " " + state.data + " " + (state.right === undefined) + " " + state.isComplete;
    for (var name in state)
        word += name[0];
    return word + JSON.stringify(Object.entries(state).map(function (entry) { return entry[0]; }));
}
console.log(show(parse(["a", "b", "c"], 0)), show(parse(["x"], 0)), show(parse([1, 2], 1).left));
console.log(show(parse(["a", "b"], "0")), show(parse(["a", "b"], 0.5)));
try {
    parse(["a"], 0).nextState.call(hide({ rule: null }));
} catch (error) {
    console.log(error.constructor.name);
}
Object.defineProperty(State.prototype, "left", { set: function (value) { this.seen = typeof value; }, get: function () { return undefined; }, configurable: true });
console.log(show(new State({ symbols: [1, 2, 3] }, 0, 1, 2).nextState({ data: 5 })));
delete State.prototype.left;
Object.defineProperty(State.prototype, "wantedBy", { set: function () { Object.freeze(this); }, configurable: true });
try {
    console.log(show(parse(["q"], 0)));
} catch (error) {
    console.log(error.constructor.name);
}
delete State.prototype.wantedBy;
console.log(show(parse(["y", "z"], 0)));
