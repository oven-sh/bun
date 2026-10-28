import { useState } from "react";

export function meta() { return [{ title: "smoke" }]; }

function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  return <button onClick={() => setCount(count + 1)}>clicked {count} times</button>;
}

export default function Home() {
  return (<main><h1>a static page</h1><ul>{[1, 2, 3].map(n => <li key={n}>{n * n}</li>)}</ul><Counter start={5} /></main>);
}
