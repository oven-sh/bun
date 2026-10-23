// Names, member accesses and patterns before in or of.
var a; for (a of []) {}
var a = {}; for (a.b in {}) {}
var a; for ([a] of []) {}
var a; for ({ a } in {}) {}
var a; for ((a) of []) {}
