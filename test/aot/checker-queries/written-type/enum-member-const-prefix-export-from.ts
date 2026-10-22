// `bun run` ends the const local prefix of a file where it parses `export { .. } from`, so it inlines no `const` of the file's own statement list, not even one above that statement.
const leading = 5;
function reads() {
  const inner = 3;
  {
    enum E { FromLeading = leading, FromInner = inner }
  }
}
export { Other } from "./enum-member-origin-other";
