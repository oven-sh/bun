import { useLoaderData } from "react-router";

export async function loader({ request }: { request: Request }) {
  await new Promise(resolve => setTimeout(resolve, 5));
  return { askedBy: request.headers.get("x-asked-by") ?? "nobody", people: [{ id: 1, name: "ada" }, { id: 2, name: "grace" }] };
}

export default function Data() {
  const { askedBy, people } = useLoaderData<typeof loader>();
  return (<main><h1>a loader that awaits data</h1><p>asked by {askedBy}</p><ol>{people.map(person => <li key={person.id}>{person.name.toUpperCase()}</li>)}</ol></main>);
}
