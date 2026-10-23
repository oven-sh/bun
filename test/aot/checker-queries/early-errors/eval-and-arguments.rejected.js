// Strict mode code, here a module: eval and arguments as the name of a class or an import, and as a target in a pattern, in a loop head or in parentheses.
class eval {}
class arguments {}
(class eval {});
import eval from "./a.js";
import * as arguments from "./a.js";
import { a as eval } from "./a.js";
import { arguments } from "./a.js";
[eval] = [];
[[arguments]] = [[]];
[...eval] = [];
({ a: eval } = {});
({ arguments } = {});
({ eval = 1 } = {});
({ ...arguments } = {});
for (eval of []) {}
for (arguments in {}) {}
for ([eval] of []) {}
for ({ arguments } of []) {}
(eval) = 1;
(arguments) += 1;
(eval)++;
--(arguments);
[[eval] = []] = [];
[...[arguments]] = [];
({ a: arguments = 1, ...eval } = {});
