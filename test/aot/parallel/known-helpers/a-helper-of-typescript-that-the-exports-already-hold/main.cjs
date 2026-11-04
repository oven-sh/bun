// `var __extends = (this && this.__extends) || ..` takes the member of the exports where there is one, and its own function where there is none.
const show = (label, made) => console.log(label, made.speak(), Object.keys(Object.getPrototypeOf(made)).join(), made instanceof made.constructor);
show("own helper", require("./own.cjs").make());
show("from the exports", require("./from-the-exports.cjs").make());
