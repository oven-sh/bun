// RUN: link
// CHECK: variable {{*}}name="counts" module=[[entry]] declared={type=undefined|null|absent|Map<undefined|null|string, number> flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="names" module=[[entry]] declared={type=undefined|null|absent|Set<undefined|null|string>

/// <reference path="./imports/registry.d.ts" />

// A declaration file has an interface that extends Map, so a value of type Map may be an object that is no Map: the type is only expected. Set has no such interface and is checked.
export let counts: Map<string, number>;
export let names: Set<string>;
