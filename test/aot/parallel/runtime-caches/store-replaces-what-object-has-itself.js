// A store by name to a property that the object has itself replaces the value where the property is a plain one that may be written. Every other form of own property has its own answer, the first time and every time.
"use strict";
const lines = [];
const calls = [];
// What comes out of evaluated text is anything: nothing is proven about the receivers.
const hide = (0, eval)("(value) => value");
function storeWidth(given, value) {
    const object = hide(given);
    object.width = value;
    return object;
}
function storeName(given, value) {
    const object = hide(given);
    object.name = value;
    return object;
}
function storeLength(given, value) {
    const object = hide(given);
    object.length = value;
    return object;
}
function Record(id) {
    this.id = id;
}
// The name is outside the layout: it lies among the extra properties.
function withExtra(descriptor) {
    const record = hide(new Record(1));
    Object.defineProperty(record, ["wid", "th"].join(""), descriptor);
    return record;
}
function ordinary(descriptor) {
    return Object.defineProperty(JSON.parse('{"first":1}'), "width", descriptor);
}
const plain = { value: 1, writable: true, enumerable: true, configurable: true };
const forms = {
    "plain": () => plain,
    "hidden from listings": () => ({ ...plain, enumerable: false }),
    "fixed in place": () => ({ ...plain, configurable: false }),
    "read-only": () => ({ ...plain, writable: false }),
    "a setter": () => ({ set(value) { calls.push("set " + value); }, get() { return "got"; }, enumerable: true, configurable: true }),
    "a getter alone": () => ({ get() { return "only got"; }, enumerable: true, configurable: true }),
};
const finishes = {
    "as it is": (object) => object,
    "frozen": (object) => Object.freeze(object),
    "sealed": (object) => Object.seal(object),
    "takes no more": (object) => Object.preventExtensions(object),
    "deleted": (object) => {
        try {
            delete object.width;
        } catch (error) {
            calls.push("delete threw");
        }
        return object;
    },
    "many more names": (object) => {
        if (Object.isExtensible(object)) {
            for (let index = 0; index < 90; index++)
                object["more" + index] = index;
        }
        return object;
    },
    "a prototype of another": (object) => (Object.create(object), object),
};
function describe(object) {
    const descriptor = Object.getOwnPropertyDescriptor(object, "width");
    return descriptor ? ("value" in descriptor ? String(descriptor.value) : "accessor") + (descriptor.writable ? "w" : "") + (descriptor.enumerable ? "e" : "") + (descriptor.configurable ? "c" : "") : "none";
}
for (const [makerName, make] of [["ordinary", ordinary], ["compiled", withExtra]]) {
    for (const [formName, form] of Object.entries(forms)) {
        for (const [finishName, finish] of Object.entries(finishes)) {
            const said = [];
            const object = finish(make(form()));
            // More stores than it takes for anything that counts to have counted.
            for (let turn = 0; turn < 40; turn++) {
                calls.length = 0;
                let outcome;
                try {
                    storeWidth(object, turn);
                    outcome = describe(object);
                } catch (error) {
                    outcome = error.constructor.name + " " + describe(object);
                }
                if (calls.length)
                    outcome += " {" + calls.join() + "}";
                if (said[said.length - 1] !== outcome && !(turn && outcome === String(turn) + said[said.length - 1].replace(/^\d+/, "")))
                    said.push(outcome);
            }
            lines.push(makerName + " | " + formName + " | " + finishName + ": " + said.join(" > ") + " | " + Object.keys(object).length);
        }
    }
}

// The form changes between two stores of one place.
for (const [makerName, make] of [["ordinary", ordinary], ["compiled", withExtra]]) {
    const object = make(plain);
    const said = [];
    const attempt = (value) => {
        calls.length = 0;
        try {
            storeWidth(object, value);
            said.push(describe(object) + (calls.length ? " {" + calls.join() + "}" : ""));
        } catch (error) {
            said.push(error.constructor.name + " " + describe(object));
        }
    };
    attempt(2);
    Object.defineProperty(object, "width", { writable: false });
    attempt(3);
    Object.defineProperty(object, "width", { writable: true });
    attempt(4);
    Object.defineProperty(object, "width", { set(value) { calls.push("late set " + value); }, configurable: true });
    attempt(5);
    delete object.width;
    attempt(6);
    Object.freeze(object);
    attempt(7);
    lines.push(makerName + " changes: " + said.join(" > "));
}

// Objects that answer for some names in a way of their own.
function attemptOn(title, store, make) {
    const said = [];
    for (let turn = 0; turn < 3; turn++) {
        const object = make();
        try {
            store(object, turn + 5);
            said.push(String(hide(object).name) + "," + String(hide(object).length));
        } catch (error) {
            said.push(error.constructor.name);
        }
    }
    lines.push(title + ": " + said.join(" > "));
}
attemptOn("the name of a function", storeName, () => function named() {});
attemptOn("the length of a function", storeLength, () => function (a, b) {});
attemptOn("the length of an array", storeLength, () => [1, 2, 3, 4, 5, 6, 7, 8, 9]);
attemptOn("the length of a text", storeLength, () => "text");
attemptOn("the name of a class", storeName, () => class Named {});
attemptOn("the name of an error", storeName, () => new RangeError("x"));
attemptOn("a proxy", storeName, () => new Proxy({ name: 1 }, { set(target, key, value) { target[key] = "by the trap " + value; return true; } }));
attemptOn("arguments", storeLength, function () { return arguments; });
attemptOn("a typed array", storeLength, () => new Uint8Array(4));
attemptOn("a bound function", storeName, () => function bound() {}.bind(null));
console.log(lines.join("\n"));
