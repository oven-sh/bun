import { useLoaderData, useRouteLoaderData } from "react-router";

export function loader({ params }: { params: { name?: string } }) { return { name: params.name ?? "nobody", at: new Date(0), big: 12345678901234567890n, seen: new Set(["a", "b"]) }; }

export default function Child() {
  const { name, at, big, seen } = useLoaderData<typeof loader>();
  return <p>child {name}, {at.toISOString()}, {String(big)}, {[...seen].join()}, under {JSON.stringify(useRouteLoaderData("routes/shell"))}</p>;
}
