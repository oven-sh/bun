// An object that a constructor function makes has the layout of the tag that it was handed. Each family below parts the tag from that layout in a way of its own,
// and a reader that tests the tag must find the names that the object really has.
const nameOfTag: string = ["ki", "nd"].join("");
const lines: string[] = [];

// nothing is done to it
interface BaseUntouched { kind: number }
interface OneUntouched extends BaseUntouched { kind: 1; one: string }
interface TwoUntouched extends BaseUntouched { kind: 2; two: number; more: number }
function MakerUntouched(this: BaseUntouched, kind: number) { this.kind = kind; }
const NewUntouched = MakerUntouched as unknown as new (kind: number) => BaseUntouched;
function readUntouched(e: OneUntouched | TwoUntouched): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewUntouched(1) as OneUntouched;
  first.one = "a";
  const second = new NewUntouched(2) as TwoUntouched;
  second.two = 5;
  second.more = 6;
  lines.push("Untouched: " + readUntouched(first) + " | " + readUntouched(second) + " | " + String((first as any).kind));
}

// the tag is stored again
interface BaseStoredAgain { kind: number }
interface OneStoredAgain extends BaseStoredAgain { kind: 1; one: string }
interface TwoStoredAgain extends BaseStoredAgain { kind: 2; two: number; more: number }
function MakerStoredAgain(this: BaseStoredAgain, kind: number) { this.kind = kind; }
const NewStoredAgain = MakerStoredAgain as unknown as new (kind: number) => BaseStoredAgain;
function readStoredAgain(e: OneStoredAgain | TwoStoredAgain): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewStoredAgain(1) as OneStoredAgain;
  first.one = "a";
  const second = new NewStoredAgain(2) as TwoStoredAgain;
  second.two = 5;
  second.more = 6;
  (first as { kind: number }).kind = 2;
  lines.push("StoredAgain: " + readStoredAgain(first) + " | " + readStoredAgain(second) + " | " + String((first as any).kind));
}

// the tag is stored through any
interface BaseStoredThroughAny { kind: number }
interface OneStoredThroughAny extends BaseStoredThroughAny { kind: 1; one: string }
interface TwoStoredThroughAny extends BaseStoredThroughAny { kind: 2; two: number; more: number }
function MakerStoredThroughAny(this: BaseStoredThroughAny, kind: number) { this.kind = kind; }
const NewStoredThroughAny = MakerStoredThroughAny as unknown as new (kind: number) => BaseStoredThroughAny;
function readStoredThroughAny(e: OneStoredThroughAny | TwoStoredThroughAny): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewStoredThroughAny(1) as OneStoredThroughAny;
  first.one = "a";
  const second = new NewStoredThroughAny(2) as TwoStoredThroughAny;
  second.two = 5;
  second.more = 6;
  (first as any).kind = 2;
  lines.push("StoredThroughAny: " + readStoredThroughAny(first) + " | " + readStoredThroughAny(second) + " | " + String((first as any).kind));
}

// the tag is stored under a computed name
interface BaseStoredUnderComputedName { kind: number }
interface OneStoredUnderComputedName extends BaseStoredUnderComputedName { kind: 1; one: string }
interface TwoStoredUnderComputedName extends BaseStoredUnderComputedName { kind: 2; two: number; more: number }
function MakerStoredUnderComputedName(this: BaseStoredUnderComputedName, kind: number) { this.kind = kind; }
const NewStoredUnderComputedName = MakerStoredUnderComputedName as unknown as new (kind: number) => BaseStoredUnderComputedName;
function readStoredUnderComputedName(e: OneStoredUnderComputedName | TwoStoredUnderComputedName): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewStoredUnderComputedName(1) as OneStoredUnderComputedName;
  first.one = "a";
  const second = new NewStoredUnderComputedName(2) as TwoStoredUnderComputedName;
  second.two = 5;
  second.more = 6;
  (first as any)[nameOfTag] = 2;
  lines.push("StoredUnderComputedName: " + readStoredUnderComputedName(first) + " | " + readStoredUnderComputedName(second) + " | " + String((first as any).kind));
}

// Object.assign copies another tag over it
interface BaseAssigned { kind: number }
interface OneAssigned extends BaseAssigned { kind: 1; one: string }
interface TwoAssigned extends BaseAssigned { kind: 2; two: number; more: number }
function MakerAssigned(this: BaseAssigned, kind: number) { this.kind = kind; }
const NewAssigned = MakerAssigned as unknown as new (kind: number) => BaseAssigned;
function readAssigned(e: OneAssigned | TwoAssigned): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewAssigned(1) as OneAssigned;
  first.one = "a";
  const second = new NewAssigned(2) as TwoAssigned;
  second.two = 5;
  second.more = 6;
  Object.assign(first, { kind: 2 });
  lines.push("Assigned: " + readAssigned(first) + " | " + readAssigned(second) + " | " + String((first as any).kind));
}

// Reflect.set stores another tag
interface BaseSetByReflect { kind: number }
interface OneSetByReflect extends BaseSetByReflect { kind: 1; one: string }
interface TwoSetByReflect extends BaseSetByReflect { kind: 2; two: number; more: number }
function MakerSetByReflect(this: BaseSetByReflect, kind: number) { this.kind = kind; }
const NewSetByReflect = MakerSetByReflect as unknown as new (kind: number) => BaseSetByReflect;
function readSetByReflect(e: OneSetByReflect | TwoSetByReflect): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewSetByReflect(1) as OneSetByReflect;
  first.one = "a";
  const second = new NewSetByReflect(2) as TwoSetByReflect;
  second.two = 5;
  second.more = 6;
  Reflect.set(first, nameOfTag, 2);
  lines.push("SetByReflect: " + readSetByReflect(first) + " | " + readSetByReflect(second) + " | " + String((first as any).kind));
}

// the tag is deleted
interface BaseDeleted { kind: number }
interface OneDeleted extends BaseDeleted { kind: 1; one: string }
interface TwoDeleted extends BaseDeleted { kind: 2; two: number; more: number }
function MakerDeleted(this: BaseDeleted, kind: number) { this.kind = kind; }
const NewDeleted = MakerDeleted as unknown as new (kind: number) => BaseDeleted;
function readDeleted(e: OneDeleted | TwoDeleted): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewDeleted(1) as OneDeleted;
  first.one = "a";
  const second = new NewDeleted(2) as TwoDeleted;
  second.two = 5;
  second.more = 6;
  delete (first as any).kind;
  lines.push("Deleted: " + readDeleted(first) + " | " + readDeleted(second) + " | " + String((first as any).kind));
}

// the tag is defined again
interface BaseRedefined { kind: number }
interface OneRedefined extends BaseRedefined { kind: 1; one: string }
interface TwoRedefined extends BaseRedefined { kind: 2; two: number; more: number }
function MakerRedefined(this: BaseRedefined, kind: number) { this.kind = kind; }
const NewRedefined = MakerRedefined as unknown as new (kind: number) => BaseRedefined;
function readRedefined(e: OneRedefined | TwoRedefined): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewRedefined(1) as OneRedefined;
  first.one = "a";
  const second = new NewRedefined(2) as TwoRedefined;
  second.two = 5;
  second.more = 6;
  Object.defineProperty(first, nameOfTag, { value: 2 });
  lines.push("Redefined: " + readRedefined(first) + " | " + readRedefined(second) + " | " + String((first as any).kind));
}

// the tag becomes an accessor
interface BaseMadeAccessor { kind: number }
interface OneMadeAccessor extends BaseMadeAccessor { kind: 1; one: string }
interface TwoMadeAccessor extends BaseMadeAccessor { kind: 2; two: number; more: number }
function MakerMadeAccessor(this: BaseMadeAccessor, kind: number) { this.kind = kind; }
const NewMadeAccessor = MakerMadeAccessor as unknown as new (kind: number) => BaseMadeAccessor;
function readMadeAccessor(e: OneMadeAccessor | TwoMadeAccessor): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewMadeAccessor(1) as OneMadeAccessor;
  first.one = "a";
  const second = new NewMadeAccessor(2) as TwoMadeAccessor;
  second.two = 5;
  second.more = 6;
  Object.defineProperty(first, nameOfTag, { get() { return 2; } });
  lines.push("MadeAccessor: " + readMadeAccessor(first) + " | " + readMadeAccessor(second) + " | " + String((first as any).kind));
}

// the maker is called again on a finished object
interface BaseCalledAgain { kind: number }
interface OneCalledAgain extends BaseCalledAgain { kind: 1; one: string }
interface TwoCalledAgain extends BaseCalledAgain { kind: 2; two: number; more: number }
function MakerCalledAgain(this: BaseCalledAgain, kind: number) { this.kind = kind; }
const NewCalledAgain = MakerCalledAgain as unknown as new (kind: number) => BaseCalledAgain;
function readCalledAgain(e: OneCalledAgain | TwoCalledAgain): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewCalledAgain(1) as OneCalledAgain;
  first.one = "a";
  const second = new NewCalledAgain(2) as TwoCalledAgain;
  second.two = 5;
  second.more = 6;
  (MakerCalledAgain as unknown as (this: object, kind: number) => void).call(first, 2);
  lines.push("CalledAgain: " + readCalledAgain(first) + " | " + readCalledAgain(second) + " | " + String((first as any).kind));
}

// The maker hands its object out before it stores the tag.
interface BaseSeenEarly { kind: number }
interface OneSeenEarly extends BaseSeenEarly { kind: 1; one: string }
interface TwoSeenEarly extends BaseSeenEarly { kind: 2; two: number; more: number }
const seenEarly: string[] = [];
function readSeenEarly(e: OneSeenEarly | TwoSeenEarly): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
function MakerSeenEarly(this: BaseSeenEarly, kind: number) {
  seenEarly.push(readSeenEarly(this as OneSeenEarly));
  this.kind = kind;
}
const NewSeenEarly = MakerSeenEarly as unknown as new (kind: number) => BaseSeenEarly;
{
  const first = new NewSeenEarly(1) as OneSeenEarly;
  first.one = "a";
  lines.push("SeenEarly: " + seenEarly.join() + " | " + readSeenEarly(first));
}

// The maker stores the tag on one way only, and its prototype has the other tag.
interface BaseStoredSometimes { kind: number }
interface OneStoredSometimes extends BaseStoredSometimes { kind: 1; one: string }
interface TwoStoredSometimes extends BaseStoredSometimes { kind: 2; two: number; more: number }
function MakerStoredSometimes(this: BaseStoredSometimes, kind: number, stores: boolean) {
  if (stores) this.kind = kind;
}
MakerStoredSometimes.prototype.kind = 2;
const NewStoredSometimes = MakerStoredSometimes as unknown as new (kind: number, stores: boolean) => BaseStoredSometimes;
function readStoredSometimes(e: OneStoredSometimes | TwoStoredSometimes): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewStoredSometimes(1, false) as OneStoredSometimes;
  first.one = "a";
  const second = new NewStoredSometimes(1, true) as OneStoredSometimes;
  second.one = "b";
  lines.push("StoredSometimes: " + readStoredSometimes(first) + " | " + readStoredSometimes(second));
}

// The maker stores into its object under another name too.
interface BaseOtherName { kind: number }
interface OneOtherName extends BaseOtherName { kind: 1; one: string }
interface TwoOtherName extends BaseOtherName { kind: 2; two: number; more: number }
function MakerOtherName(this: BaseOtherName, kind: number, other: BaseOtherName | undefined) {
  this.kind = kind;
  const target = other === undefined ? this : other;
  target.kind = 2;
}
const NewOtherName = MakerOtherName as unknown as new (kind: number, other: BaseOtherName | undefined) => BaseOtherName;
function readOtherName(e: OneOtherName | TwoOtherName): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewOtherName(1, undefined) as OneOtherName;
  first.one = "a";
  lines.push("OtherName: " + readOtherName(first));
}

// Another function is new.target, so the maker fills an object that it has not allocated by the tag.
interface BaseOtherTarget { kind: number }
interface OneOtherTarget extends BaseOtherTarget { kind: 1; one: string }
interface TwoOtherTarget extends BaseOtherTarget { kind: 2; two: number; more: number }
function MakerOtherTarget(this: BaseOtherTarget, kind: number) { this.kind = kind; }
function OtherTarget() {}
const NewOtherTarget = MakerOtherTarget as unknown as new (kind: number) => BaseOtherTarget;
function readOtherTarget(e: OneOtherTarget | TwoOtherTarget): string {
  if (e.kind === 1) return "one " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = Reflect.construct(MakerOtherTarget, [1], OtherTarget) as OneOtherTarget;
  first.one = "a";
  const second = new NewOtherTarget(2) as TwoOtherTarget;
  second.two = 5;
  second.more = 6;
  lines.push("OtherTarget: " + readOtherTarget(first) + " | " + readOtherTarget(second) + " | " + (first instanceof OtherTarget));
}

// Zero and minus zero take one case of a switch. A tag that no type writes has no layout of its own.
interface BaseZero { kind: number }
interface OneZero extends BaseZero { kind: 0; one: string }
interface TwoZero extends BaseZero { kind: 2; two: number; more: number }
function MakerZero(this: BaseZero, kind: number) { this.kind = kind; }
const NewZero = MakerZero as unknown as new (kind: number) => BaseZero;
function readZero(e: OneZero | TwoZero): string {
  if (Object.is(e.kind, -0)) return "minus zero " + (e as OneZero).one;
  if (e.kind === 0) return "zero " + e.one;
  return "two " + e.two + " " + e.more;
}
{
  const first = new NewZero(-0) as OneZero;
  first.one = "a";
  const second = new NewZero(0) as OneZero;
  second.one = "b";
  const third = new NewZero(7) as unknown as TwoZero;
  third.two = 5;
  third.more = 6;
  lines.push("Zero: " + readZero(first) + " | " + readZero(second) + " | " + readZero(third));
}

console.log(lines.join("\n"));
