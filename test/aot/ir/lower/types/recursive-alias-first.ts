// RUN(ALIAS): link
// ALIAS: variable [[alias]] {{*}}declared={type=undefined|null|string|absent|Array<undefined|null|string|Array> site=

// RUN(ARRAY): link
// ARRAY: variable [[array]] {{*}}declared={type=undefined|null|absent|Array<undefined|null|string|Array<undefined|null|string|Array>> site=

type Json = string | Json[];

export let a: Json;
export let b: Json[];
