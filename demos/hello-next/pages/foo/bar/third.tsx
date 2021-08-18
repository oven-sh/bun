import Link from "next/link";

export default function Baz({}) {
  return (
    <div style={{ padding: 16 }}>
      <h1>Third</h1>
      <ul>
        <li>
          <a href="/">Root page</a>
        </li>
        <li>
          <a href="/second">Second page</a>
        </li>
      </ul>
    </div>
  );
}
