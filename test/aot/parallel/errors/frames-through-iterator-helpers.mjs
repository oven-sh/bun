// Prints the frames of what is thrown below the helpers of iterators. The generator that a helper makes is listed at the `{` of its body in the text of the built-in.
const frames = error => String(error && error.stack).split("\n").slice(1, 7).map(line => line.trim().replace(/^at /, "").replace(/\(?[^ (]*\.mjs:/, "(").replace(/^\((\d+:\d+)$/, "($1)")).join(" < ");
function attempt(run) { try { const result = run(); console.log(run.name + ": nothing " + typeof result); } catch (error) { console.log(run.name + ": " + (error && error.constructor.name) + " " + frames(error)); } }
const hide = value => [value, 0][Number(process.argv.length > 100)];
function fail() { throw new Error("thrown"); }
const list = hide([1, 2, 3]);
function* source() { yield 1; yield 2; }
function* throwing() { yield 1; fail(); }
attempt(function mapNext() { hide(list.values().map(fail).next()); });
attempt(function filterNext() { hide(list.values().filter(fail).next()); });
attempt(function flatMapNext() { hide(list.values().flatMap(fail).next()); });
attempt(function takeNext() { hide(throwing().take(5).toArray()); });
attempt(function dropNext() { hide(throwing().drop(1).next()); });
attempt(function mapToArray() { hide(list.values().map(fail).toArray()); });
attempt(function mapSpread() { hide([...list.values().map(fail)]); });
attempt(function mapForOf() { for (const item of list.values().map(fail)) hide(item); });
attempt(function chained() { hide(list.values().map(x => x).filter(fail).toArray()); });
attempt(function chainedThree() { hide(source().map(x => x).filter(x => x).map(fail).toArray()); });
attempt(function forEach() { list.values().forEach(fail); });
attempt(function some() { hide(list.values().some(fail)); });
attempt(function every() { hide(list.values().every(fail)); });
attempt(function find() { hide(list.values().find(fail)); });
attempt(function reduce() { hide(list.values().reduce(fail)); });
attempt(function sourceThrowsInMap() { hide(throwing().map(x => x).toArray()); });
attempt(function sourceThrowsInFilter() { hide(throwing().filter(x => x).toArray()); });
attempt(function sourceThrowsInFlatMap() { hide(throwing().flatMap(x => [x]).toArray()); });
attempt(function innerThrowsInFlatMap() { hide(source().flatMap(() => throwing()).toArray()); });
attempt(function fromObject() { hide(Iterator.from({ next: fail }).next()); });
attempt(function fromObjectMap() { hide(Iterator.from({ next: fail }).map(x => x).next()); });
attempt(function concat() { hide(Iterator.concat(list, throwing()).toArray()); });
attempt(function mapOfMap() { hide(new Map([[1, 2]]).entries().map(fail).next()); });
attempt(function setValues() { hide(new Set([1]).values().filter(fail).next()); });
attempt(function stringIterator() { hide("ab"[Symbol.iterator]().map(fail).next()); });
attempt(function flatMapNumber() { [1].values().flatMap(() => 5).next(); });
attempt(function flatMapString() { [1].values().flatMap(() => "a").next(); });
attempt(function iteratorFromNumber() { Iterator.from(5); });
attempt(function iteratorConcatNumber() { Iterator.concat(5); });
attempt(function iteratorZipNumber() { Iterator.zip(5); });
attempt(function iteratorZipOptions() { Iterator.zip([], 5); });
attempt(function mapNotCallable() { [1].values().map(5); });
attempt(function takeNaN() { [1].values().take(NaN); });
attempt(function dropNegative() { [1].values().drop(-1); });
