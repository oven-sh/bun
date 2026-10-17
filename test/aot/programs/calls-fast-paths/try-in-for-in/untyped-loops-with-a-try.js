"use strict";
function sweep(locks, remove) {
    let seen = "";
    for (const file in locks) {
        const options = locks[file].options;
        try { remove(file, options); } catch (e) { seen += "!" + e.message; }
        seen += " " + file + ":" + options;
    }
    return seen;
}
function firstThatWorks(func, places) {
    var rval = null, type, done = false, exception = null;
    for (var idx in places) {
        type = places[idx];
        try {
            if (type === "bad") throw new Error("not here");
            rval = func(type);
            done = true;
        } catch (ex) { exception = ex; }
        if (done) break;
    }
    if (!done) throw exception;
    return rval + " at " + idx + " of " + type;
}
function deletesInTheBody(o, act) {
    let seen = "";
    for (const k in o) {
        try { act(k); } catch (e) { seen += "!"; }
        if (k === "a") delete o.c;
        seen += k;
    }
    return seen;
}
function deletesInTheHandler(o, act) {
    let seen = "";
    for (const k in o) {
        try { act(k); } catch (e) { delete o.c; seen += "!"; }
        seen += k;
    }
    return seen;
}
function addsInTheHandler(o, act) {
    let seen = "";
    for (const k in o) {
        try { act(k); } catch (e) { o["new" + k] = 1; seen += "!"; }
        seen += k;
    }
    return seen + " " + Object.keys(o).join();
}
function nested(o, p, act) {
    let seen = "";
    for (const k in o) {
        for (const l in p) {
            try { act(k + l); } catch (e) { seen += "!"; }
            seen += k + l + " ";
        }
        try { act(k); } catch (e) { seen += "?"; }
    }
    return seen;
}
function oneBehindTheOther(o, p, act) {
    let seen = "";
    for (const k in o) { try { act(k); } catch (e) { seen += "!"; } seen += k; }
    for (const l in p) { try { act(l); } catch (e) { seen += "?"; } seen += l; }
    return seen;
}
function withFinally(o, act) {
    let seen = "";
    for (const k in o) {
        try { try { act(k); } finally { seen += "f"; } } catch (e) { seen += "!"; }
        seen += k;
    }
    return seen;
}
function theLoopInTheTry(o, act) {
    let seen = "";
    try { for (const k in o) { act(k); seen += k; } } catch (e) { seen += "!"; }
    for (const k in o) seen += k;
    return seen;
}
module.exports = { sweep, firstThatWorks, deletesInTheBody, deletesInTheHandler, addsInTheHandler, nested, oneBehindTheOther, withFinally, theLoopInTheTry };
