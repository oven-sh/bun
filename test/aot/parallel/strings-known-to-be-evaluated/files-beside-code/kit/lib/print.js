(function (DEF) {
    DEF(NODE_Leaf, function (out) { out.push(this.value); });
    DEF(NODE_Pair, function (out) { out.push("("); this.left.print(out); this.right.print(out); out.push(")"); });
})(function (type, method) {
    type.DEFMETHOD("print", method);
});
function print(node) {
    var out = [];
    node.print(out);
    return out.join("");
}
function tokens(text) {
    var found = [], match, pattern = /\s*(?:(\d+)|([a-z]\w*)|\/\*.*?\*\/|(<!--|-->|>=|.))/gi;
    outer: for (;;) {
        for (; match = pattern.exec(text);) {
            switch (true) {
              case match[0] === "":
                break outer;
              case !match[1] && !match[2] && !match[3]:
                continue outer;
              default:
                found.push(match[1] ? +match[1] : match[2] || match[3]);
            }
        }
        break;
    }
    return found.length + " " + found.map(function (it) { return typeof it == "number" ? "#" + it : it; }).join(" ");
}
function fails(it) {
    // "a" ---> "b"
    return it.missing.other;
}
