// The sixth argument of jsxDEV is `this`, and no `this` is written: the run time sees the object while its constructor runs: every declared field is there, undefined until it is stored.
class Page { title: string; view: unknown; size = 1; constructor(title: string) { this.view = <p />; this.title = title; } }
class Behind { title: string; view: unknown; constructor(title: string) { this.title = title; this.view = <b />; } }
class InAnArrow { title: string; make: () => unknown; constructor(title: string) { const make = () => <i />; this.make = make; console.log(make()); this.title = title; } }
console.log(new Page("a").view, new Behind("b").view, new InAnArrow("c").make());
