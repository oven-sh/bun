class Holder {
  method(this: unknown) { "use strict"; return this === undefined; }
  made(this: unknown) { "use strict" as string; return this === undefined; }
}
const forms: Function[] = [
  function (this: unknown) { "use strict"; return this === undefined; },
  function (this: unknown) { 'use strict'; return this === undefined; },
  function (this: unknown) { "first"; "use strict"; return this === undefined; },
  function (this: unknown) {
    "use strict"
    return this === undefined
  },
  function (this: unknown) { "use strict" as string; return this === undefined; },
  function (this: unknown) { <string>"use strict"; return this === undefined; },
  function (this: unknown) { "use strict"!; return this === undefined; },
  function (this: unknown) { "use strict" satisfies string; return this === undefined; },
  function (this: unknown) { 'use strict' as const; return this === undefined; },
  function (this: unknown) { ("use strict" as string); return this === undefined; },
  function (this: unknown) { type Gone = number; "use strict" as string; return this === undefined; },
  function (this: unknown) { true && "use strict"; return this === undefined; },
  function (this: unknown) { "first"; true && "use strict"; return this === undefined; },
  function (this: unknown) { "use strict".length; return this === undefined; },
  function (this: unknown) { let kept = 1; "use strict"; return this === undefined; },
  function (this: unknown) { return this === undefined; },
];
const said = forms.map(one => String(new Function("return (" + String(one) + "\n)")()()));
for (const name of ["method", "made"] as const) said.push(String(new Function("return ({ " + String(Holder.prototype[name]) + "\n})." + name)()()));
console.log(said.join(" "));
