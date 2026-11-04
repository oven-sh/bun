// A part of a text that grows is an object whose conversion has side effects, and throws in the third turn: the order, the hint, and the text that the catch finds.
const log: string[] = [];

function part(name: string, failsAt: number) {
    let calls = 0;
    return {
        [Symbol.toPrimitive](hint: string) {
            log.push(name + ":" + hint + ":" + ++calls);
            if (calls === failsAt)
                throw new RangeError(name + " fails");
            return name + calls;
        },
    };
}

function build(first: any, second: any, turns: number): string {
    let text = "";
    try {
        for (let i = 0; i < turns; i++) {
            text += first;
            text = `${text}/${second}`;
            text += "<" + first + second + ">";
        }
    } catch (error) {
        return "caught " + (error as Error).message + " with " + JSON.stringify(text);
    }
    return text;
}

function deed(failsFirst: number, failsSecond: number) {
    log.length = 0;
    console.log(build(part("a", failsFirst), part("b", failsSecond), 3));
    console.log(log.join(" "));
}

deed(0, 0);
deed(1, 0);
deed(2, 0);
deed(0, 1);
deed(0, 2);
deed(5, 0);
deed(0, 6);
