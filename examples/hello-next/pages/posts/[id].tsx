import { useRouter } from "next/router";
import Link from "next/link";

export default function Post({}) {
  const router = useRouter();

  return (
    <div style={{ padding: 16 }}>
      <h1>Post: {router.query.id}</h1>
      <ul>
        <li>
          <Link href="/">
            <a>Root page</a>
          </Link>
        </li>
      </ul>
    </div>
  );
}
