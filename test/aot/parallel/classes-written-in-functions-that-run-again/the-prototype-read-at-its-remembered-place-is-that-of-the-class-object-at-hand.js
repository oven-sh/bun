// Two class objects of one class share a structure until something is done to one of them. Whatever moves `prototype` in its storage, changes the structure
// or clears what is remembered: an instance stands below the prototype of the class object that it was made with.
"use strict";
function written(step) { return class Written { constructor(n) { this.size = n + step; } }; }
const First = written(1), Second = written(2);
function look(what) {
    const first = new First(1), second = new Second(1);
    const right = Object.getPrototypeOf(first) === First.prototype && Object.getPrototypeOf(second) === Second.prototype;
    const apart = first instanceof First && !(first instanceof Second) && second instanceof Second && !(second instanceof First);
    console.log(what, right, apart, first.size, second.size);
}
look("as made");
look("again");
First.extra = 1;
look("a static is added to one");
look("again");
First[0] = 1;
Second[70000] = 1;
look("stores by index");
for (let at = 0; at < 100; at++) First["name" + at] = at;
look("a hundred more");
for (let at = 0; at < 100; at++) delete First["name" + at];
look("and taken away");
look("again");
delete First.extra;
look("the first static goes");
console.log(Object.getOwnPropertyNames(Second).join());
look("the names of the other are listed");
Object.defineProperty(Second, "name", { value: "renamed" });
look("its name is defined anew");
Object.setPrototypeOf(First, function above() {});
look("one gets another parent");
Bun.gc(true);
look("behind a collection");
Object.freeze(Second);
look("the other is frozen");
Object.preventExtensions(First);
look("one takes no more names");
const third = written(3), fourth = written(4);
console.log(Object.getPrototypeOf(new third(1)) === third.prototype, Object.getPrototypeOf(new fourth(1)) === fourth.prototype, third.prototype !== fourth.prototype);
look("two more evaluations");
