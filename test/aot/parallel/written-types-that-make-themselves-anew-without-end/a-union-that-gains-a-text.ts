type Marks<S extends string> = { all: S[]; more?: Marks<S | `${S}x`> };
const marks: Marks<"a"> = { all: ["a"], more: { all: ["a", "ax"], more: { all: ["axx"], more: { all: ["axxx", "a"], more: { all: [] } } } } };
console.log(marks.all.length, marks.more?.all.join(), marks.more?.more?.more?.all.join(), marks.more?.more?.more?.more?.all.length);
export {};
