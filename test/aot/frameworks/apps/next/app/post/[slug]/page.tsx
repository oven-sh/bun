export function generateStaticParams() {
  return [{ slug: "first" }, { slug: "second" }];
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <article><h1>post {slug}</h1><p>{slug.length} letters</p></article>;
}
