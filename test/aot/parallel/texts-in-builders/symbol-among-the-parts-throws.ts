// A symbol arrives as a part of a text that grows: the join throws a TypeError, and the text is what it was in front of that join.
function sum(parts: any[]): string {
    let text = "";
    let done = 0;
    try {
        for (let i = 0; i < parts.length; i++) {
            text += parts[i];
            done++;
        }
    } catch (error) {
        return (error as Error).name + " behind " + done + " with " + JSON.stringify(text);
    }
    return text;
}

function template(parts: any[]): string {
    let text = "";
    let done = 0;
    try {
        for (let i = 0; i < parts.length; i++) {
            text = `${text}[${parts[i]}]`;
            done++;
        }
    } catch (error) {
        return (error as Error).name + " behind " + done + " with " + JSON.stringify(text);
    }
    return text;
}

function deed(parts: any[]) {
    console.log(sum(parts));
    console.log(template(parts));
}

deed(["a", 1, null]);
deed([Symbol("first")]);
deed(["a", "b", Symbol.iterator, "c"]);
deed(["a", Object(Symbol("boxed")), "c"]);
deed(["a", { toString() { return Symbol("made"); } }, "c"]);
