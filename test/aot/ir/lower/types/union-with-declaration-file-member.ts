// RUN: link
// CHECK: layout [[declared]] fields=[{key="x"
// CHECK: layout [[chunk]] {{*}}fields=[{key="n"
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=undefined|null|absent|[[declared]]|[[chunk]] flags=[IsExpected]}

// RUN(SITES): lower
// SITES-NOT: site=
// SITES: = Convert {{*}}declared={type=undefined|null|L{{*}}|L{{*}} flags=[IsExpected]}
// SITES-NOT: site=

/// <reference path="./imports/shapes.d.ts" />

// One member that a declaration file describes makes the whole union expected: the position has the flag and no site.
interface Chunk {
  n: number;
}

export let v: Chunk | Declared;
