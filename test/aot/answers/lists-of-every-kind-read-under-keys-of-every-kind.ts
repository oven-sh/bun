// answers: without-library
// # a proven list is read under a key of which nothing is proven: an int32 finds an own element in line, and every other key, and whatever the list lacks, gets what the closed read gives
// # each list is a constant of the module, so that it is proven a list. f1 = under_integers, f2 = under_fractions, f4 = under_objects: of a variable's list no kind of storage is known
// # f21 = atObjects, f22 = atNumbers: every caller is known, and what the lists hold with them: the read of objects names the storage; `number[]` declares none
// # OPTIONS: check=Validate
// # RUN(FORM): walk f1 mechanisms=all
// # FORM: = GetArrayElement {{*}}level=Expected
// # RUN(NUMBERS): walk f2 mechanisms=all
// # NUMBERS: = GetArrayElement {{*}}level=Expected
// # RUN(OBJECTS): walk f4 mechanisms=all
// # OBJECTS: = GetArrayElement {{*}}level=Expected
// # RUN(NAMED): walk f21 mechanisms=all-Inlining
// # NAMED: = GetArrayElement {{*}}arrayStorage=Contiguous level=Expected
// # RUN(DOUBLES): walk f22 mechanisms=all-Inlining
// # DOUBLES: = GetArrayElement {{*}}level=Expected
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 108 of 108 of 108
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function under_integers(key: any): unknown { return integers[key]; }
function under_fractions(key: any): unknown { return fractions[key]; }
function under_wholeNumbers(key: any): unknown { return wholeNumbers[key]; }
function under_objects(key: any): unknown { return objects[key]; }
function under_mixed(key: any): unknown { return mixed[key]; }
function under_holes(key: any): unknown { return holes[key]; }
function under_holesInFractions(key: any): unknown { return holesInFractions[key]; }
function under_holesInObjects(key: any): unknown { return holesInObjects[key]; }
function under_empty(key: any): unknown { return empty[key]; }
function under_sparse(key: any): unknown { return sparse[key]; }
function under_sparseObjects(key: any): unknown { return sparseObjects[key]; }
function under_named(key: any): unknown { return named[key]; }
function under_frozen(key: any): unknown { return frozen[key]; }
function under_withGetter(key: any): unknown { return withGetter[key]; }
function under_long(key: any): unknown { return long[key]; }
function under_shrunk(key: any): unknown { return shrunk[key]; }
function under_numbersForObjects(key: any): unknown { return numbersForObjects[key]; }
function under_fractionsForObjects(key: any): unknown { return fractionsForObjects[key]; }
function under_objectsForNumbers(key: any): unknown { return objectsForNumbers[key]; }
function under_otherPrototype(key: any): unknown { return otherPrototype[key]; }
function atObjects(list: { n: number }[], key: any): unknown { return list[key]; }
function atNumbers(list: number[], key: any): unknown { return list[key]; }
function show(value: unknown): string { return typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : String(value); }
const mark = Symbol("mark");
let asked = 0;
const keys: any[] = [0, 1, 2, 3, 4, 7, -1, -0, 0.5, 1.0, 1e9, 100000, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 2, 2 ** 32 - 1, 2 ** 32, 2 ** 53, -(2 ** 31), NaN, Infinity, "0", "1", "01", "1.0", "-1", "length", "push", "extra", "", mark, Symbol.iterator, null, undefined, true, false, 1n, { toString() { asked++; return "1"; } }, { valueOf() { asked++; return 2; }, toString() { asked++; return "2"; } }, [1], [], [1, 2]];
const integers: any[] = [10, 11, 12];
const fractions: number[] = [0.5, 1.5, 2.5];
const wholeNumbers: number[] = [10, 11, 12];
const objects: { n: number }[] = [{ n: 1 }, { n: 2 }, { n: 3 }];
const mixed: any[] = [1, "two", { n: 3 }, null, undefined];
const holes: any[] = [1, , 3, , 5];
const holesInFractions: number[] = [0.5, , 2.5] as number[];
const holesInObjects: { n: number }[] = [{ n: 1 }, , { n: 3 }] as { n: number }[];
const empty: { n: number }[] = [];
const sparse: any[] = [1, 2, 3];
const sparseObjects: { n: number }[] = [{ n: 1 }];
const named: any[] = [1, 2, 3];
const frozen: any[] = [1, 2, 3];
const withGetter: { n: number }[] = [{ n: 1 }, { n: 2 }, { n: 3 }];
const long: any[] = [];
const shrunk: number[] = [1, 2, 3, 4, 5];
const numbersForObjects: { n: number }[] = [1, 2, 3] as any;
const fractionsForObjects: { n: number }[] = [0.5, 1.5] as any;
const objectsForNumbers: number[] = [{ n: 1 }, { n: 2 }] as any;
const otherPrototype: any[] = [1, 2, 3];
sparse[100000] = 4;
sparseObjects[100000] = { n: 2 };
(named as any).extra = "extra of the list";
(named as any)[-1] = "minus one";
(named as any)["01"] = "zero one";
(named as any)[mark] = "under the mark";
(named as any)[0.5] = "a half";
Object.freeze(frozen);
Object.defineProperty(withGetter, 1, { get() { asked++; return "from the getter"; } });
long.length = 5;
shrunk.length = 2;
Object.setPrototypeOf(otherPrototype, { 5: "five of another prototype", extra: "extra of another prototype" });
const readers: [string, (key: any) => unknown][] = [["integers", under_integers], ["fractions", under_fractions], ["wholeNumbers", under_wholeNumbers], ["objects", under_objects], ["mixed", under_mixed], ["holes", under_holes], ["holesInFractions", under_holesInFractions], ["holesInObjects", under_holesInObjects], ["empty", under_empty], ["sparse", under_sparse], ["sparseObjects", under_sparseObjects], ["named", under_named], ["frozen", under_frozen], ["withGetter", under_withGetter], ["long", under_long], ["shrunk", under_shrunk], ["numbersForObjects", under_numbersForObjects], ["fractionsForObjects", under_fractionsForObjects], ["objectsForNumbers", under_objectsForNumbers], ["otherPrototype", under_otherPrototype]];
for (const [name, read] of readers) { let line = name + ":"; for (const key of keys) line += " " + show(read(key)); report(line + " asked " + asked); }
for (const key of keys) report("objects: " + show(atObjects([{ n: 1 }, { n: 2 }, { n: 3 }], key)) + " " + show(atObjects([{ n: 1 }, , { n: 3 }] as { n: number }[], key)) + " " + show(atObjects([], key)));
for (const key of keys) report("numbers: " + show(atNumbers([0.5, 1.5, 2.5], key)) + " " + show(atNumbers([10, 11, 12], key)) + " " + show(atNumbers([0.5, , 2.5] as number[], key)) + " " + show(atNumbers([], key)));
try { report(show(under_integers({ toString() { throw new RangeError("the key throws"); } }))); } catch (error) { report((error as Error).message); }
try { report(show(under_objects(Object.create(null)))); } catch (error) { report((error as Error).constructor.name); }
integers.length = 0;
objects.push({ n: 4 });
fractions[1] = "a text now" as any;
wholeNumbers[1] = 0.25;
report([under_integers(0), show(under_objects(3)), under_fractions(1), under_fractions(2), under_wholeNumbers(1), under_wholeNumbers(2)].join(" "));
report("end");
