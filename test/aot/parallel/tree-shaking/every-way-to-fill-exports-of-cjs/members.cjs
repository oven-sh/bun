function viaExports() { return "exports.name"; }
function viaModuleExports() { return "module.exports.name"; }
function viaThis() { return "this.name"; }
function viaComputed() { return "exports[name]"; }

exports.viaExports = viaExports;
module.exports.viaModuleExports = viaModuleExports;
this.viaThis = viaThis;
exports["via" + "Computed"] = viaComputed;
