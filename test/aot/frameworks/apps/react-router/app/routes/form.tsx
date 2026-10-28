import { createCookie, data, Form, useActionData, useLoaderData } from "react-router";

const remembered = createCookie("remembered", { path: "/", sameSite: "lax", secrets: ["a secret of the test"] });

export async function loader({ request }: { request: Request }) {
  return { remembered: ((await remembered.parse(request.headers.get("cookie"))) as string | null) ?? "nothing" };
}

export async function action({ request }: { request: Request }) {
  const word = String((await request.formData()).get("word") ?? "");
  if (!word) return data({ saved: 0, missing: true }, { status: 400 });
  return data({ saved: word.length, missing: false }, { headers: { "set-cookie": await remembered.serialize(word.toUpperCase()) } });
}

export default function Remember() {
  const loaded = useLoaderData<typeof loader>();
  const said = useActionData<typeof action>();
  return (<main><Form method="post"><input name="word" /><button>remember</button></Form><p>remembered {loaded.remembered}; the action said {JSON.stringify(said ?? null)}</p></main>);
}
