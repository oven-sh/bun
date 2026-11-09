export const revalidate = 1;

let rendered = 0;

export default function Page() {
  rendered++;
  return <p>a page that is made again: {rendered > 0 ? "rendered" : "never"}</p>;
}
