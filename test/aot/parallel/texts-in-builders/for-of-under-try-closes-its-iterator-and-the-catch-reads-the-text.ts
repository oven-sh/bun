// A `for of` under `try` grows a text. The body throws: the iterator is closed, then the `catch` reads the text as it was at the throw.
const log: string[] = [];

function source(count: number) {
    return {
        [Symbol.iterator]() {
            let next = 0;
            return {
                next() {
                    return next < count ? { done: false, value: next++ } : { done: true, value: undefined };
                },
                return() {
                    log.push("closed at " + next);
                    return {};
                },
            };
        },
    };
}

function build(count: number, failsAt: number): string {
    let text = "";
    try {
        for (const value of source(count)) {
            if (value === failsAt)
                throw new Error("fails at " + value);
            text += value + ",";
        }
    } catch (error) {
        return (error as Error).message + " with " + JSON.stringify(text);
    }
    return text;
}

function deed(count: number, failsAt: number) {
    log.length = 0;
    console.log(build(count, failsAt), log.join(";"));
}

deed(0, 0);
deed(4, -1);
deed(4, 0);
deed(4, 2);
deed(4, 3);
