// a row of `||` and a chain of `if` over comparisons with constants are asked about objects with valueOf, toString and Symbol.toPrimitive, and about a Proxy: none of that code may run
let ran = 0;
function isKind(k) { return k === 1 || k === 4 || k === 9; }
function verb(k) { if (k === "get") return 1; else if (k === "set") return 2; else if (k === "has") return 3; return 0; }
const subjects = [
    { valueOf() { ran++; return 1; } },
    { toString() { ran++; return "get"; } },
    { [Symbol.toPrimitive]() { ran++; return 4; } },
    new Proxy({}, { get() { ran++; return () => 9; } }),
    new Number(1),
    new String("set"),
];
function deed(k) { return isKind(k) + "/" + verb(k); }
let out = "";
for (let i = 0; i < subjects.length; i++) out += deed(subjects[i]) + " ";
console.log(out, String(ran));
for (let turn = 0; turn < 400; turn++) for (let i = 0; i < subjects.length; i++) deed(subjects[i]);
console.log(String(ran));
