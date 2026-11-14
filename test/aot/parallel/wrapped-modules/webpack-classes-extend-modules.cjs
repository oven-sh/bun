// A class of a webpack module extends the class that another module exports as a whole. Its objects have one layout with the parent's fields, and the parent's methods know them.
// COUNTER in every build: DynamicSubclassInstances = 0
(() => {
    var modules = {
        "./node.js": ((module, exports, __webpack_require__) => {
            "use strict";
            class Node {
                constructor(type) { this.type = type; this.parent = undefined; this.count = 0; }
                get self() { return this; }
                bump() { this.count += 1; return this.count; }
                describe() { return this.type + Object.keys(this).join(); }
            }
            module.exports = Node;
            Node.default = Node;
        }),
        "./container.js": ((module, exports, __webpack_require__) => {
            "use strict";
            let Node = __webpack_require__("./node.js");
            let Rule;
            class Container extends Node {
                constructor(type) { super(type); this.nodes = []; }
                push(child) { child.parent = this.self; this.nodes.push(child); return this; }
                each(callback) {
                    let result = 0;
                    for (let index = 0; index < this.self.nodes.length; ++index)
                        result += callback(this.self.nodes[index], index);
                    return result;
                }
                make() { return new Rule("made"); }
            }
            Container.registerRule = dependant => { Rule = dependant; };
            module.exports = Container;
            Container.default = Container;
        }),
        "./rule.js": ((module, exports, __webpack_require__) => {
            "use strict";
            let Container = __webpack_require__("./container.js");
            let Base = Container;
            class Rule extends Base {
                constructor(selector) { super("rule"); this.selector = selector; }
                describe() { return super.describe() + ":" + this.selector; }
            }
            module.exports = Rule;
            Rule.default = Rule;
            Container.registerRule(Rule);
        }),
        "./root.js": ((module, exports, __webpack_require__) => {
            "use strict";
            class Root extends __webpack_require__("./container.js") {
                constructor() { super("root"); }
            }
            module.exports = Root;
        }),
        "./entry.js": ((module, exports, __webpack_require__) => {
            "use strict";
            let Rule = __webpack_require__("./rule.js"), Root = __webpack_require__("./root.js"), Node = __webpack_require__("./node.js"), Container = __webpack_require__("./container.js");
            let root = new Root(), sum = 0;
            for (let i = 0; i < 50; ++i)
                root.push(new Rule("s" + i).push(new Node("leaf")));
            for (let round = 0; round < 20; ++round)
                sum += root.each((rule, index) => rule.each(leaf => leaf.bump() + index));
            console.log(sum, root.describe(), root.nodes[3].describe(), root.nodes[3].nodes[0].describe());
            console.log(root instanceof Container, root.nodes[0] instanceof Node, root.make().describe(), Object.getPrototypeOf(Rule) === Container, Container.default === Container);
            // What is laid between later is found.
            Container.prototype.each = function () { return -1; };
            Object.defineProperty(Node.prototype, "type", { set(value) { this.seen = value; }, get() { return "got"; }, configurable: true });
            let late = new Rule("late");
            console.log(root.each(() => 1), JSON.stringify(late), late.type);
            Object.setPrototypeOf(Rule.prototype, Root.prototype);
            Object.setPrototypeOf(Rule, Root);
            console.log(new Rule("moved") instanceof Root, JSON.stringify(new Rule("moved")));
        }),
    };
    var cache = {};
    function __webpack_require__(id) {
        var cached = cache[id];
        if (cached !== undefined) { return cached.exports; }
        var module = cache[id] = { exports: {} };
        modules[id](module, module.exports, __webpack_require__);
        return module.exports;
    }
    __webpack_require__("./entry.js");
})();
