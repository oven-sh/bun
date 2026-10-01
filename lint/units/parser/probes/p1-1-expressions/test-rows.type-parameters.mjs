export const groups = {
  "after type parameters": [
    ["ts", "x = a ? <T>(y: T) => (b) : c => d;"],
    ["ts", "x = a ? <T>() => (b) : c => d;"],
    ["ts", "x = a ? <T>(y: T) => ({ y }) : z => ({ z });"],
    ["ts", "x = a ? <T extends U>(y: T) => (b) : c => d;"],
    ["ts", "x = a ? <T>(...y: T[]) => (b) : c => d;"],
    ["ts", "x = a ? async <T>(y: T) => (b) : c => d;"],
    ["ts", "x = a ? async <T>() => (b) : c => d;"],
  ],
};
