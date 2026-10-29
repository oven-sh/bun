// A module fails with the error that left its body, also where the close of an iterator ran code of its own on the way.
const t = () => { try { require("./m.cjs") } catch (e) { return e.message } };
console.log(t(), t());
