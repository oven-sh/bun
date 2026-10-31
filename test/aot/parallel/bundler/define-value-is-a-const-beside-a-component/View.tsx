declare const NAME: string;
const t0 = "the const of the file";
export function View({ title }: { title: string }) {
  const lines = [NAME, title];
  return <p>{lines.join(" ")}</p>;
}
