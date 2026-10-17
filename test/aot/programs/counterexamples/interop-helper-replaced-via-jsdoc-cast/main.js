// An interop helper that is replaced through a JSDoc cast is called in its new form.
function _interop(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
/** @type {any} */ (_interop) = () => ({ default: { a: "replaced" } });
console.log(_interop(require("./lib")).default.a);
