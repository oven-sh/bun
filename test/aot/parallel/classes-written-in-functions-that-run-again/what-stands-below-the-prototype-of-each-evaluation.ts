// A class written in a function that runs again is a NEW class at each run: a new class object, a new prototype. The run time keeps what it learned at the last evaluation (the shapes of both objects; that nothing
// stands below the prototype yet). Here everything that could make that word false happens between an evaluation and the first construction, or between two constructions.
function makePlain(): any {
  return class Lone { size: number; constructor(n: number) { this.size = n + 1; } };
}
function makeWithMembers(): any {
  return class Lone {
    size: number;
    constructor(n: number) { this.size = n + 1; }
    double() { return this.size * 2; }
    get half() { return this.size / 2; }
    static kind = "lone";
    static plain(n: number) { return n; }
    static of(n: number) { return new Lone(n); }
  };
}
class Other { mark: number; constructor(n: number) { this.mark = n; } }
const relations = (made: any, Class: any) => [Object.getPrototypeOf(made) === Class.prototype, made.constructor === Class, made instanceof Class, Class.prototype.constructor === Class, Reflect.ownKeys(Class.prototype).join(), Reflect.ownKeys(made).join(), made.double?.(), made.half, Class.of?.(1) instanceof Class];
function situations(kind: string, make: () => any) {
  const say = (label: string, ...values: unknown[]) => console.log(kind + ":", label, ...values.map(value => JSON.stringify(value)));
  for (let warm = 0; warm < 5; warm++) new (make())(warm);

  let before: any = null;
  for (let round = 0; round < 4; round++) {
    const Class = make();
    const made = new Class(round);
    say("each run has a class of its own", relations(made, Class), before ? [made instanceof before, Class === before, Class.prototype === before.prototype] : null);
    before = Class;
  }
  {
    const Class = make();
    const created: any = Object.create(Class.prototype);
    const made = new Class(1);
    say("an object is created below the prototype first", relations(made, Class), created instanceof Class, Object.getPrototypeOf(created) === Object.getPrototypeOf(made), created.size);
  }
  {
    const Class = make();
    const laid: any = Object.setPrototypeOf({ size: 9 }, Class.prototype);
    const made = new Class(2);
    say("an object is laid below the prototype first", relations(made, Class), laid instanceof Class, laid.size, made.size);
  }
  {
    const Class = make();
    const foreign: any = Reflect.construct(Other, [3], Class);
    const made = new Class(3);
    const again: any = Reflect.construct(Other, [4], Class);
    say("another class is constructed for it first", relations(made, Class), foreign instanceof Class, foreign instanceof Other, foreign.mark, again.mark, Object.getPrototypeOf(again) === Class.prototype);
  }
  {
    const Class = make();
    const turned: any = Reflect.construct(Class, [5], Other);
    const made = new Class(5);
    say("it is constructed for another class first", relations(made, Class), turned instanceof Other, turned instanceof Class, turned.size);
  }
  {
    const Class = make();
    class Heir extends Class { more: number; constructor(n: number) { super(n); this.more = n * 2; } }
    const heir: any = new Heir(6);
    const made = new Class(6);
    say("an heir is constructed first", relations(made, Class), relations(heir, Heir), heir instanceof Class, heir.size, heir.more);
  }
  {
    const Class = make();
    Bun.gc(true);
    const made = new Class(7);
    Bun.gc(true);
    const second = new Class(8);
    say("the collector runs in between", relations(made, Class), relations(second, Class), Object.getPrototypeOf(made) === Object.getPrototypeOf(second));
  }
  {
    const Class = make();
    Class.prototype.extra = "laid";
    Class.prototype.twice = function () { return this.size * 2; };
    const made = new Class(9);
    say("names are laid on the prototype first", relations(made, Class), made.extra, made.twice());
  }
  {
    const Class = make();
    Object.freeze(Class.prototype);
    const made = new Class(10);
    say("the prototype is frozen first", relations(made, Class), Object.isFrozen(Class.prototype));
  }
  {
    const Class = make();
    Class.prototype.constructor = Other;
    const made = new Class(11);
    say("another constructor is named on the prototype", Object.getPrototypeOf(made) === Class.prototype, made.constructor === Other, made instanceof Class, made instanceof Other, made.size);
  }
  {
    const Class = make();
    Object.setPrototypeOf(Class.prototype, Other.prototype);
    const made = new Class(12);
    say("the prototype gets another parent first", relations(made, Class), made instanceof Other);
  }
  {
    const first = make(), second = make();
    const said: unknown[] = [];
    for (let turn = 0; turn < 6; turn++) { const Class = turn & 1 ? second : first; const made = new Class(turn); said.push([made instanceof first, made instanceof second, made.size]); }
    say("two evaluations take turns at one place", said);
  }
  {
    const older = make();
    const early = new older(13);
    const Class = make();
    const late = new older(14);
    const made = new Class(15);
    say("an older evaluation is constructed behind a newer one", relations(late, older), relations(made, Class), Object.getPrototypeOf(early) === Object.getPrototypeOf(late), late instanceof Class);
  }
  {
    const classes: any[] = [];
    for (let each = 0; each < 40; each++) classes.push(make());
    let right = 0;
    for (let turn = 0; turn < 3; turn++) for (const Class of classes) { const made = new Class(turn); if (Object.getPrototypeOf(made) === Class.prototype && made.size === turn + 1) right++; }
    say("forty evaluations, none constructed at once", right);
  }
}
situations("a plain class", makePlain);
situations("a class with members", makeWithMembers);
