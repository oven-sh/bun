import { permanentRedirect, redirect } from "next/navigation";

export default async function Page({ searchParams }: { searchParams: Promise<{ forever?: string }> }) {
  if ((await searchParams).forever) permanentRedirect("/post/first");
  redirect("/who");
}
