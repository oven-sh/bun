// JSX imports `jsx` from "react/jsx-runtime" without a statement, and that file picks in a branch whose exports it hands on, as the entry of React does.
declare const console: { log(...values: unknown[]): void };
const element = () => <div>a</div>;
console.log(JSON.stringify(element()));
