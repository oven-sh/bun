import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: "person " + (await params).id };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <p>person {id}, doubled {Number(id) * 2}, greeted with {(await searchParams).greeting ?? "nothing"}</p>;
}
