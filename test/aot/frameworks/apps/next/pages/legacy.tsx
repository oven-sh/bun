import type { GetServerSideProps } from "next";

interface Props { asked: string; squares: number[] }

export const getServerSideProps: GetServerSideProps<Props> = async context => ({
  props: { asked: String(context.query.q ?? "nothing"), squares: [1, 2, 3].map(n => n * n) },
});

export default function Legacy({ asked, squares }: Props) {
  return <main><h1>the pages router</h1><p>asked {asked}: {squares.join()}</p></main>;
}
