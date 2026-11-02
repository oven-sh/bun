// RUN: link
// CHECK: layout [[declared]] name="Declared"
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=undefined|null|absent|[[declared]] flags=[IsExpected]}

// RUN(SITES): lower
// SITES-NOT: site=
// SITES: = Convert {{*}}declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// SITES-NOT: site=

/// <reference path="./imports/shapes.d.ts" />

// Nobody compiles what a declaration file describes, so its type is expected and never checked: the position has the flag and no site.
export let v: Declared;
