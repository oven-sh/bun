export function sweep(locks, remove) {
    let seen = "";
    for (const file in locks) {
        const options = locks[file].options;
        try { remove(file, options); } catch (e) { seen += "!" + e.message; }
        seen += " " + file + ":" + options;
    }
    return seen;
}
export function firstThatWorks(func, places) {
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
