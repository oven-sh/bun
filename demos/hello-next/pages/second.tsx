import Link from "next/link";

export default function Second({}) {
  return (
    <div style={{ padding: 16 }}>
      <h1>Second</h1>

      <ul>
        <li>
          <Link href="/">
            <a>Root page</a>
          </Link>
        </li>
        <li>
          <Link href="/foo/bar/third">
            <a>Third! page</a>
          </Link>
        </li>
      </ul>
    </div>
  );
}
