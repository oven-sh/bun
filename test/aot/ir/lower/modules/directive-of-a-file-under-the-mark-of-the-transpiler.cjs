// `bun run` hands a file under its mark to the engine as it is written, so a directive there is what the language takes for one: a bare string, compared as it is written.

// RUN(PLAIN): link
// PLAIN: function {{*}}name="behindTheDirective"
// PLAIN-NOT: IsSloppy
// PLAIN: thisType=

// RUN(PARENTHESES): link
// PARENTHESES: function {{*}}name="behindParentheses"{{*}}flags=[IsSloppy

// RUN(ESCAPE): link
// ESCAPE: function {{*}}name="behindAnEscape"{{*}}flags=[IsSloppy

// FILE: main.cjs
module.exports = [require("./plain.js"), require("./parentheses.js"), require("./escape.js")];

// FILE: plain.js
// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {"use strict";
module.exports = function behindTheDirective() {
  return this;
};
})

// FILE: parentheses.js
// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {("use strict");
module.exports = function behindParentheses() {
  return this;
};
})

// FILE: escape.js
// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {"use\x20strict";
module.exports = function behindAnEscape() {
  return this;
};
})
