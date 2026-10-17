import { Suspense } from "react";
import { Await, useLoaderData } from "react-router";

export function loader() {
  return { now: "at once", later: new Promise<string>(resolve => setTimeout(() => resolve("streamed later"), 10)) };
}

export default function Stream() {
  const { now, later } = useLoaderData<typeof loader>();
  return (<main><p>{now}</p><Suspense fallback={<p>waiting</p>}><Await resolve={later}>{word => <p>{word}</p>}</Await></Suspense></main>);
}
