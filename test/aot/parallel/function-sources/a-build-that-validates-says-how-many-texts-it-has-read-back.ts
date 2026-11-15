// Flags: --aot-check=Validate
// STATISTIC: FunctionSourcesReparsed >= 3
// One text has a type erased, one is kept as written, one is a class: each is parsed again and held against the tree, and the count says so: no ring alone cannot tell right from unread.
function typed(value: number): number { return value + 1; }
function plain() { return 2; }
class Held { run() { return 3; } }
console.log(typed(1), plain(), new Held().run());
