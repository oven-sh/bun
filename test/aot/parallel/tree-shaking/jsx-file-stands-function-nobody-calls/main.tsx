// The automatic runtime is imported because the file has JSX, and evaluated when the file is, although the one element stands in a function that nobody calls.
/** @jsxImportSource ./mini */
function Unused() {
  return <p>never</p>;
}

console.log("main.tsx runs");
