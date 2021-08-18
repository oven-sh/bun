import Link from "next/link";

export default function Second({}) {
  return (
    <div style={{ padding: 16 }}>
      <h1>Second</h1>

      <ul>
        <li>
          <a href="/">Root page</a>
        </li>
        <li>
          <a href="/foo/bar/third">Third page</a>
        </li>
      </ul>
    </div>
  );
}
