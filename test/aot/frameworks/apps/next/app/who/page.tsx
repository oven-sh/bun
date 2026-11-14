import { cookies, headers } from "next/headers";

export default async function Page() {
  const [jar, incoming] = await Promise.all([cookies(), headers()]);
  return <p>cookie {jar.get("who")?.value ?? "none"}, language {incoming.get("accept-language") ?? "none"}, {jar.getAll().length} cookies</p>;
}
