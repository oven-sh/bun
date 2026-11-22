// The names under numbers that are no index keep their place among the names: -1, 1.5 and 1e21 are names like any other.
var Signs;
(function (Signs) {
    Signs[Signs["Below"] = -1] = "Below";
    Signs[Signs["Zero"] = 0] = "Zero";
    Signs[Signs["Half"] = 0.5] = "Half";
    Signs[Signs["Above"] = 1] = "Above";
    Signs[Signs["Far"] = 1e21] = "Far";
    Signs[Signs["Wide"] = 4294967295] = "Wide";
    Signs[Signs["Widest"] = 4294967294] = "Widest";
    Signs["Text"] = "text";
})(Signs || (Signs = {}));
console.log(Object.keys(Signs).join());
console.log(JSON.stringify(Signs));
console.log(Signs[-1], Signs[0], Signs[0.5], Signs[1], Signs[1e21], Signs[4294967295], Signs["-1"], Signs["1e+21"]);
console.log(Signs.Below, Signs.Zero, Signs.Half, Signs.Above, Signs.Far, Signs.Wide, Signs.Text);
for (const name in Signs) console.log(name, typeof Signs[name]);
console.log(Object.getOwnPropertyNames(Signs).length, Reflect.ownKeys(Signs).join("|"));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(Signs, "-1")), JSON.stringify(Object.getOwnPropertyDescriptor(Signs, "Below")));
