function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export = function (target, all) { target.b = Object.keys(all).join(); };
_export(exports, {
    a: function() {
        return a;
    }
});
const a = "a";
