import type { int32 } from "bun";
interface Point { x: int32; y: int32 }
class Pixel { x: int32 = 1; y: int32 = 2; }
interface Chain { value: int32; next?: Chain }
interface Counter { count: int32; bump(): void }
interface Pair<A, B> { first: A; second: B }
interface Tree { size: int32; children: Tree[] }
type Callable = { (): void; calls: int32 };
interface Indexed { [key: string]: unknown; total: int32 }
abstract class Shape { abstract area: int32; }
class Square extends Shape { area: int32 = 4; }
function make(x: int32, y: int32): Point { return { x, y }; }
function makePixel(): Pixel { return new Pixel(); }
function makeChain(): Chain { return { value: 3, next: { value: 4 } }; }
function makeCounter(): Counter { return { count: 5, bump() { this.count = (this.count + 1) | 0; } }; }
function makePair(): Pair<int32, string> { return { first: 6, second: "s" }; }
function makeTree(): Tree { return { size: 7, children: [{ size: 8, children: [] }] }; }
function makeCallable(): Callable { return Object.assign(() => {}, { calls: 9 as int32 }); }
function makeIndexed(): Indexed { return { total: 10 }; }

function classNamed(pixel: Pixel): int32 { return pixel.x; }
function classUnnamed(): int32 { return makePixel().y; }
function chainNamed(chain: Chain): int32 { return chain.value; }
function chainUnnamed(): int32 { return makeChain().value; }
function chainDeep(): int32 { return makeChain().next?.value ?? -1; }
function counterNamed(counter: Counter): int32 { counter.bump(); return counter.count; }
function counterUnnamed(): int32 { return makeCounter().count; }
function pairNamed(pair: Pair<int32, string>): int32 { return pair.first; }
function pairUnnamed(): int32 { return makePair().first; }
function treeNamed(tree: Tree): int32 { return tree.children[0].size; }
function treeUnnamed(): int32 { return makeTree().children[0].size; }
function callableNamed(callable: Callable): int32 { return callable.calls; }
function callableUnnamed(): int32 { return makeCallable().calls; }
function indexedNamed(indexed: Indexed): int32 { return indexed.total; }
function indexedUnnamed(): int32 { return makeIndexed().total; }
function readonlyUnnamed(): int32 { return (make(13, 14) as Readonly<Point>).x; }
function partialUnnamed(maker: () => Partial<Point>): int32 { return maker().y ?? -2; }
function pickedUnnamed(maker: () => Pick<Point, "x">): int32 { return maker().x; }
function requiredUnnamed(maker: () => Required<{ x?: int32 }>): int32 { return maker().x; }
function intersectionUnnamed(maker: () => Point & { name: string }): int32 { return maker().y; }
function abstractNamed(shape: Shape): int32 { return shape.area; }
function abstractUnnamed(maker: () => Shape): int32 { return maker().area; }

console.log(
  classNamed(makePixel()), classUnnamed(), chainNamed(makeChain()), chainUnnamed(), chainDeep(), counterNamed(makeCounter()), counterUnnamed(), pairNamed(makePair()), pairUnnamed(),
  treeNamed(makeTree()), treeUnnamed(), callableNamed(makeCallable()), callableUnnamed(), indexedNamed(makeIndexed()), indexedUnnamed(), readonlyUnnamed(), partialUnnamed(() => ({})), pickedUnnamed(() => ({ x: 15 })),
  requiredUnnamed(() => ({ x: 16 })), intersectionUnnamed(() => ({ x: 17, y: 18, name: "n" })), abstractNamed(new Square()), abstractUnnamed(() => new Square()),
);
