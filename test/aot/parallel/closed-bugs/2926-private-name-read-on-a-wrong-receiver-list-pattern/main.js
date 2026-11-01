import { tell } from "./tell.js";
function nested(v) { const [[x]] = v; return x; }
function flat(v) { const [x] = v; return x; }
function parameter([[x]]) { return x; }
function underName(v) { const { p: [x] } = v; return x; }
function assigned(v) { let x; [[x]] = v; return x; }
function objectInList(v) { const [{ x }] = v; return x; }
tell({
  "[[x]] = [null]": () => nested([null]),
  "[[x]] = [undefined]": () => nested([undefined]),
  "[x] = null": () => flat(null),
  "[x] = undefined": () => flat(undefined),
  "parameter [[x]] of [null]": () => parameter([null]),
  "{ p: [x] } = { p: null }": () => underName({ p: null }),
  "assigned [[x]] = [null]": () => assigned([null]),
  "[{ x }] = [null]": () => objectInList([null]),
});
