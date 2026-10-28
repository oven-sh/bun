function kind(list) { return /(CopyOnWrite)?ArrayWith\w+/.exec(describe(list))?.[0] ?? "no array"; }
function tell(name, list) { console.log(name + ": " + kind(list) + ", " + list.length + ": " + JSON.stringify(list)); }
function pair(first, second) { return [first, second]; }
tell("filled with a whole number", new Array(3).fill(7));
tell("filled with a fraction", new Array(3).fill(0.5));
tell("filled with a text", new Array(3).fill("a"));
tell("filled with undefined", new Array(3).fill(undefined));
tell("from a length, whole numbers", Array.from({ length: 3 }, (_, index) => index));
tell("from a length, fractions", Array.from({ length: 3 }, (_, index) => index / 2));
tell("from a length, texts", Array.from({ length: 3 }, (_, index) => "t" + index));
tell("from a length, numbers and then a text", Array.from({ length: 3 }, (_, index) => (index < 2 ? index : "t")));
tell("from a length, nothing", Array.from({ length: 0 }, (_, index) => index));
tell("filled and mapped to whole numbers", new Array(3).fill(0).map((_, index) => index));
tell("filled and mapped to fractions", new Array(3).fill(0).map((_, index) => index / 2));
tell("filled and mapped to texts", new Array(3).fill(0).map((_, index) => "t" + index));
tell("whole numbers sorted into a new list", [3, 1, 2].toSorted((a, b) => a - b));
tell("fractions sorted into a new list", [3.5, 1.5, 2.5].toSorted((a, b) => a - b));
tell("a literal of two parameters", pair(1, 2));
tell("a literal of two parameters, one fraction", pair(1, 2.5));
tell("a literal of two parameters, one left out", pair(1));
