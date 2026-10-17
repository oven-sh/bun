import { headers } from "next/headers";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

interface Person { id: number; name: string }

async function people(): Promise<Person[]> {
  await new Promise(resolve => setTimeout(resolve, 5));
  return [{ id: 1, name: "ada" }, { id: 2, name: "grace" }];
}

async function Slow() {
  await new Promise(resolve => setTimeout(resolve, 20));
  return <p>streamed later</p>;
}

export default async function Page() {
  const [all, incoming] = await Promise.all([people(), headers()]);
  return (
    <main>
      <h1>a server component that awaits data</h1>
      <p>asked by {incoming.get("x-asked-by") ?? "nobody"}</p>
      <ol>{all.map(person => <li key={person.id}>{person.name.toUpperCase()}</li>)}</ol>
      <Suspense fallback={<p>waiting</p>}><Slow /></Suspense>
    </main>
  );
}
