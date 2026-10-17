import { afterStatement } from "./after-statement.js";
import { afterDirective } from "./after-directive.jsx";
import { lineComment } from "./line-comment.js";
import { lastWins } from "./last-wins.js";
import { atEnd } from "./at-end.tsx";
import { fragment } from "./fragment.js";
console.log([afterStatement, afterDirective, lineComment, lastWins, atEnd, fragment].join(" | "));
