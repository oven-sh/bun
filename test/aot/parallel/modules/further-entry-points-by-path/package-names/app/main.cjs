const orm = require("orm");
console.log(orm.connect("driver"), orm.connect("@scope/driver"), orm.connect("driver/lib/extra"));
orm.imports("both").then(ns => console.log(ns.default, orm.connect("both")));
