// Classes below one base class differ in what their prototype objects have under a name that the base class stores. What is known about one of them says nothing about its siblings.
"use strict";
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
const calls = [];
function describe(object) {
    return JSON.stringify(object) + " [" + Object.keys(object).join() + "] " + String(object.level) + " " + String(object.other);
}
// What comes out of evaluated text is anything: nothing is proven about the receivers.
const hide = (0, eval)("(value) => value");

class Base {
    constructor(level, isSeen) {
        this.id = level;
        if (isSeen) {
            // Seen code gives the layouts of all the classes the two names.
            this.level = level;
            this.other = "seen";
            return;
        }
        const hidden = hide(this);
        try {
            hidden.level = level;
        } catch (error) {
            calls.push(error.constructor.name);
        }
        hidden.other = "other";
    }
}
class Plain extends Base {}
class AlsoPlain extends Base {}
class WithSetter extends Base {
    set level(value) {
        calls.push("set " + value);
    }
    get level() {
        return "got";
    }
}
class WithGetterOnly extends Base {
    get level() {
        return "only got";
    }
}
class WithMethod extends Base {
    level() {
        return "called";
    }
}
class BelowSetter extends WithSetter {}
class BelowPlain extends Plain {}
class ReadOnly extends Base {}
Object.defineProperty(ReadOnly.prototype, "level", { value: "fixed", writable: false, configurable: true });
class Later extends Base {}

const classes = [Plain, WithSetter, AlsoPlain, WithGetterOnly, WithMethod, BelowSetter, BelowPlain, ReadOnly, Later];
function round(title, isSeen) {
    say(title);
    for (let turn = 0; turn < 3; turn++) {
        for (const constructor of classes) {
            calls.length = 0;
            let made;
            try {
                made = new constructor(turn + 1, isSeen);
            } catch (error) {
                say(" ", constructor.name, "throws", error.constructor.name);
                continue;
            }
            say(" ", constructor.name, describe(made), "{" + calls.join() + "}");
        }
    }
}
round("hidden stores", false);
round("seen stores", true);
round("hidden stores again", false);

// One sibling changes; the others stay as they were.
Object.defineProperty(Later.prototype, "level", {
    set(value) {
        calls.push("late set " + value);
    },
    get() {
        return "late";
    },
    configurable: true,
});
round("a setter came to one class", false);
round("a setter came to one class, seen stores", true);
delete Later.prototype.level;
round("and went", false);
Object.defineProperty(Plain.prototype, "other", { value: "stays", writable: false, configurable: true });
function attemptRound(title, isSeen) {
    try {
        round(title, isSeen);
    } catch (error) {
        say(title, "ends with", error.constructor.name);
    }
}
attemptRound("the other name cannot be written below one class", false);
delete Plain.prototype.other;
Object.setPrototypeOf(AlsoPlain.prototype, WithSetter.prototype);
attemptRound("a class moved below the class with the setter", false);
Object.setPrototypeOf(AlsoPlain.prototype, Base.prototype);
attemptRound("and back", false);
Object.freeze(Base.prototype);
attemptRound("the prototype object of the base class is frozen", false);

// Many objects of each class, so that whatever learns has learned.
let sum = 0;
for (let turn = 0; turn < 3000; turn++) {
    for (const constructor of classes) {
        calls.length = 0;
        try {
            const made = new constructor(turn, (turn & 7) === 7);
            sum += Object.keys(made).length * 10 + calls.length;
        } catch (error) {
            sum += 1000;
        }
    }
}
say("sum", sum);
round("at the end", false);
console.log(lines.join("\n"));
