// Only a type argument that somebody wrote reaches the written type of a member. An access takes the receiver's type from the checker, which may have inferred the arguments, so its written type is the member's in the declared form of the receiver. An instantiated mapped type has no declared form.
class Box<B> { value: B; constructor(value: B) { this.value = value; } }
interface Holder<H> { value: H }
interface Plain { value: string }
interface Table<E> { [key: string]: E }
type Wrapper<W> = { value: W };
declare function hold<T>(value: T): Holder<T>;
declare function wrap<T>(value: T): Wrapper<T>;
declare function part<T>(value: T): Partial<Box<T>>;
declare function either<T>(value: T): Holder<T> | Plain;
declare function both<T>(value: T): Holder<T> & { label: T };
declare function table<T>(value: T): Table<T>;
const box = new Box(1);
box.value;
box["value"];
hold(1).value;
wrap(1).value;
part(1).value;
either(1).value;
both(1).value;
both(1).label;
table(1).first;
let written: Holder<number>;
export {};
