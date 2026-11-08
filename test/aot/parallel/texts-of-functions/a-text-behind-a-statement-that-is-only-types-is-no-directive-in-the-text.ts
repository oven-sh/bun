class Holder { method(this: unknown) { type Gone = number; "use strict"; return this === undefined; } }
const asked: Function[] = [
  function (this: unknown) { type Gone = number; "use strict"; return this === undefined; },
  function (this: unknown) { interface Gone {} "use strict"; return this === undefined; },
  function (this: unknown) { type Gone = number; 'use strict'; return this === undefined; },
  function (this: unknown) { type Gone = number; type More = string; "use strict"; return this === undefined; },
  function (this: unknown) { let kept = 1; "use strict"; return this === undefined; },
  function (this: unknown) { type Gone = number; return this === undefined; },
];
const said = asked.map(one => String(new Function("return (" + String(one) + "\n)")()()));
said.push(String(new Function("return ({ " + String(Holder.prototype.method) + "\n}).method")()()));
console.log(said.join(" "));
