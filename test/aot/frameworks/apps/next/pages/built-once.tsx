import type { GetStaticProps } from "next";

export const getStaticProps: GetStaticProps<{ words: string[] }> = async () => ({ props: { words: ["made", "at", "the", "build"] } });

export default function BuiltOnce({ words }: { words: string[] }) {
  return <p>{words.join(" ")}</p>;
}
