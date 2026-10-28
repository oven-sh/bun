// Plain Bun ends the prefix of inlined `const`s of a file where it parses `export { .. } from`, so a `const` above every other statement of such a file is a variable. The prefix of a function in the file is not affected.
const leading = 5;
function row(label: string, value: object) {
  console.log(label + ": " + Object.keys(value).map(key => key + "=" + String((value as any)[key])).join());
}

function reads() {
  const inner = 3;
  {
    enum E { Leading = leading, AfterLeading, Inner = inner, AfterInner }
    return E;
  }
}
row("a file that exports from another", reads());
export { shared } from "./shared";
