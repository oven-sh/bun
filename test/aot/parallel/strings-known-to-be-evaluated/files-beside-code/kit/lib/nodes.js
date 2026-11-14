/* Nodes are made by “DEFNODE” */
function DEFNODE(type, props, methods, base) {
    if (typeof base === "undefined") base = NODE_Any;
    props = props ? props.split(/\s+/) : [];
    var own = props;
    if (base && base.PROPS) props = props.concat(base.PROPS);
    var code = [ "return function NODE_", type, "(props){", "this.flags=0;", "if(props){" ];
    props.forEach(function (prop) {
        code.push("this.", prop, "=props.", prop, ";");
    });
    code.push("}");
    var proto = Object.create(base && base.prototype);
    if (methods.initialize || proto.initialize) code.push("this.initialize();");
    code.push("};");
    var ctor = new Function(code.join(""))();
    ctor.prototype = proto;
    ctor.prototype.CTOR = ctor;
    ctor.prototype.TYPE = ctor.TYPE = type;
    if (base) {
        ctor.BASE = base;
        base.SUBCLASSES.push(ctor);
    }
    ctor.DEFMETHOD = function (name, method) {
        this.prototype[name] = method;
    };
    ctor.PROPS = props;
    ctor.OWN = own;
    ctor.SUBCLASSES = [];
    for (var name in methods) if (HOP(methods, name)) {
        if (/^\$/.test(name)) {
            ctor[name.substr(1)] = methods[name];
        } else {
            ctor.DEFMETHOD(name, methods[name]);
        }
    }
    if (typeof exports !== "undefined") exports["NODE_" + type] = ctor;
    return ctor;
}
var NODE_Any = DEFNODE("Any", "start", {
    $documentation: "any node",
    size: function () { return 1; },
}, null);
var NODE_Leaf = DEFNODE("Leaf", "value  quote", {
    toJSON: function () { return this.TYPE + ":" + this.value; },
});
var NODE_Parent = DEFNODE("Parent", null, {
    initialize: function () { this.seen = true; },
}, NODE_Any);
var NODE_Pair = DEFNODE("Pair", "left right", {
    size: function () { return 1 + this.left.size() + this.right.size(); },
}, NODE_Parent);
