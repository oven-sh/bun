// A function that returns a join of numbers is called in the middle of a row of joins, and the variable that holds it is stored into between two calls.
let tag = (n: number): string => "[" + n + "]";

function line(n: number): string {
    return "<" + tag(n) + ">";
}

function deed(n: number) {
    console.log(line(n), line(n + 0.5), line(-n));
}

deed(0);
deed(7);
for (let turn = 0; turn < 3; turn++)
    deed(turn);
tag = n => "{" + n * 2 + "}";
deed(7);
tag = n => (n as any) as string;
deed(7);
tag = () => ({ toString() { return "object"; } }) as any;
deed(7);
tag = n => "[" + n + "]";
deed(7);
