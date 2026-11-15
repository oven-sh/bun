import { Counter } from "./counter";

export default function Page() {
  return (
    <main>
      <h1>a static page</h1>
      <ul>{[1, 2, 3].map(n => <li key={n}>{n * n}</li>)}</ul>
      <Counter start={5} />
    </main>
  );
}
