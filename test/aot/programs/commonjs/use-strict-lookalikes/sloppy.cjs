function hexadecimalEscape() { "use\x20strict"; return typeof this; }
function unicodeEscape() { "use\u{20}strict"; return typeof this; }
function lineContinuation() { "use str\
ict"; return typeof this; }
function inParentheses() { ("use strict"); return typeof this; }
function template() { `use strict`; return typeof this; }
function behindParentheses() { ("other"); "use strict"; return typeof this; }
function behindTemplate() { `other`; "use strict"; return typeof this; }
function behindNumber() { 1; "use strict"; return typeof this; }
function partOfSum() { "use strict" + ""; return typeof this; }
function receiver() { "use strict"
  .length; return typeof this; }
function upperCase() { "USE STRICT"; return typeof this; }
function withSpace() { " use strict"; return typeof this; }
function parameters(a) { "use\x20strict"; a = 2; return arguments[0]; }
const arrow = function () { return (() => { ("use strict"); return typeof this; })(); };
const all = [hexadecimalEscape, unicodeEscape, lineContinuation, inParentheses, template, behindParentheses, behindTemplate, behindNumber, partOfSum, receiver, upperCase, withSpace, arrow];
exports.answers = () => all.map(f => f.name + ": " + f.call(5)).join("\n") + "\nparameters: " + parameters(1);
