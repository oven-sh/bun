function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        configurable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    }
});
const a = "a";
