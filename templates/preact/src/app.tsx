import { useState } from "preact/hooks";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <div class="h-full column-center">
      <div class="row">
        <a href="https://bun.sh" target="_blank">
          <img src="/logo.svg" class="logo" alt="Bun logo" />
        </a>
        <a href="https://preactjs.com" target="_blank">
          <img src={"/preact.svg"} class="logo preact" alt="Preact logo" />
        </a>
      </div>
      <h1>Bun + Preact</h1>

      <button onClick={() => setCount(count => count + 1)}>count is {count}</button>

      <p class="read-the-docs">Click on the Bun and Preact logos to learn more</p>
    </div>
  );
}
