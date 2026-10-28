import { Outlet, useLoaderData } from "react-router";

export function loader() { return { title: "the parent's data" }; }

export default function Shell() {
  return <section><h2>{useLoaderData<typeof loader>().title}</h2><Outlet /></section>;
}
