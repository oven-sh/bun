declare const NAME: string;
export function View({ title }: { title: string }) {
  const lines = [NAME, title];
  return <p>{lines.join(" ")}</p>;
}
