import { data, useLoaderData } from "react-router";

export async function loader({ params, request }: { params: { id?: string }; request: Request }) {
  if (!/^\d+$/.test(params.id ?? "")) throw data("no such person", { status: 404 });
  return { id: Number(params.id), greeting: new URL(request.url).searchParams.get("greeting") ?? "nothing" };
}

export function meta({ data: loaded }: { data?: { id: number } }) { return [{ title: "person " + loaded?.id }]; }

export default function Person() {
  const { id, greeting } = useLoaderData<typeof loader>();
  return <p>person {id}, doubled {id * 2}, greeted with {greeting}</p>;
}
