import Link from "next/link";

export default function Baz({}) {
  return (
    <div style={{ padding: 16 }}>
      <h1>Third</h1>
      <ul>
        <li>
          <Link href="/">
            <a>Root page</a>
          </Link>
        </li>
        <li>
          <Link href="/second">
            <a>Second page</a>
          </Link>
        </li>
        <li>
          <Link href="/posts/123">
            <a>Post page 123</a>
          </Link>
        </li>
      </ul>
    </div>
  );
}
